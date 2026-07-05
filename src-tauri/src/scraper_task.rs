#![allow(dead_code, unused_variables)]
//! Gestionnaire de tâches de scraping asynchrone.
//! File d'attente avec un seul worker, annulation, reprise, et émission d'événements.

use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tauri::AppHandle;
use crate::scraper_candidates::{ScrapeStatus, ScrapeCandidates};

// ─── Task types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum TaskPriority {
    Normal,
    High,
}

/// Paramètres optionnels passés au moteur de scraping (pour les produits pas encore en DB).
#[derive(Debug, Clone, Default)]
pub struct ScrapeParams {
    pub vpc_site: Option<String>,
    pub vpc_code: Option<String>,
    pub mpn: Option<String>,
    pub brand: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ScrapeTask {
    pub sku: String,
    pub priority: TaskPriority,
    pub cancel_token: CancellationToken,
    pub params: Option<ScrapeParams>,
}

#[derive(Debug, Clone)]
pub struct TaskStatus {
    pub sku: String,
    pub status: ScrapeStatus,
    pub progress: f32,
    pub message: String,
}

// ─── Task Manager ─────────────────────────────────────────────────────────────

pub struct ScrapeTaskManager {
    queue: Arc<Mutex<VecDeque<ScrapeTask>>>,
    active_skus: Arc<Mutex<Vec<String>>>,
    cancel_tokens: Arc<Mutex<std::collections::HashMap<String, CancellationToken>>>,
    active_workers: Arc<Mutex<usize>>,
    app_handle: AppHandle,
    network_path: Arc<Mutex<String>>,
}

impl ScrapeTaskManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let network_path = crate::config::load_config_internal()
            .map(|c| c.network_path.clone())
            .unwrap_or_default();

        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            active_skus: Arc::new(Mutex::new(Vec::new())),
            cancel_tokens: Arc::new(Mutex::new(std::collections::HashMap::new())),
            active_workers: Arc::new(Mutex::new(0)),
            app_handle,
            network_path: Arc::new(Mutex::new(network_path)),
        }
    }

    /// Met à jour le chemin réseau (appelé après changement de config).
    pub async fn set_network_path(&self, path: String) {
        let mut np = self.network_path.lock().await;
        *np = path;
    }

    /// Ajoute un SKU à la file d'attente de scraping, avec paramètres optionnels.
    pub async fn enqueue(&self, sku: String, priority: TaskPriority) {
        self.enqueue_with_params(sku, priority, None).await;
    }

    /// Ajoute un SKU à la file d'attente avec des paramètres de contexte (VPC, MPN, marque).
    pub async fn enqueue_with_params(&self, sku: String, priority: TaskPriority, params: Option<ScrapeParams>) {
        let sku_upper = sku.to_uppercase();
        let mut queue = self.queue.lock().await;
        
        // Nettoyer les cancel_tokens des tâches retirées de la queue
        let removed: Vec<String> = queue.iter()
            .filter(|t| t.sku == sku_upper)
            .map(|t| t.sku.clone())
            .collect();
        queue.retain(|t| t.sku != sku_upper);
        drop(queue);
        {
            let mut tokens = self.cancel_tokens.lock().await;
            for s in &removed {
                tokens.remove(s);
            }
        }
        let mut queue = self.queue.lock().await;
        
        // Vérifier si déjà en cours — si oui, on ajoute quand même en priorité haute
        let active = self.active_skus.lock().await;
        let already_active = active.contains(&sku_upper);
        drop(active);
        if already_active && params.is_none() {
            drop(queue);
            return;
        }

        let cancel_token = CancellationToken::new();
        let mut tokens = self.cancel_tokens.lock().await;
        tokens.insert(sku_upper.clone(), cancel_token.clone());
        drop(tokens);

        let task = ScrapeTask {
            sku: sku_upper,
            priority,
            cancel_token,
            params,
        };

        match task.priority {
            TaskPriority::High => queue.push_front(task),
            TaskPriority::Normal => queue.push_back(task),
        }
        drop(queue);

        // Démarrer le worker s'il ne tourne pas
        self.start_worker_if_needed().await;
    }

    /// Annule le scraping d'un SKU (en cours ou en attente).
    pub async fn cancel(&self, sku: &str) {
        let sku_upper = sku.to_uppercase();
        
        // Retirer de la file d'attente
        let mut queue = self.queue.lock().await;
        queue.retain(|t| t.sku != sku_upper);
        drop(queue);

        // Annuler si en cours et nettoyer le token
        let mut tokens = self.cancel_tokens.lock().await;
        if let Some(token) = tokens.get(&sku_upper) {
            token.cancel();
        }
        // Retirer le token (nettoyage pour éviter la fuite mémoire)
        tokens.remove(&sku_upper);
    }

    /// Annule toutes les tâches.
    pub async fn cancel_all(&self) {
        let mut queue = self.queue.lock().await;
        queue.clear();
        drop(queue);

        let tokens = self.cancel_tokens.lock().await;
        for (_, token) in tokens.iter() {
            token.cancel();
        }
    }

    /// Reprend le scraping d'un SKU (re-enqueue pour traitement incrémental).
    pub async fn resume(&self, sku: String) {
        let sku_upper = sku.to_uppercase();
        self.enqueue(sku_upper, TaskPriority::High).await;
    }

    /// Reprend le scraping avec des paramètres de contexte.
    pub async fn resume_with_params(&self, sku: String, params: ScrapeParams) {
        let sku_upper = sku.to_uppercase();
        self.enqueue_with_params(sku_upper, TaskPriority::High, Some(params)).await;
    }

    /// Retourne les informations de la file d'attente : (nb_en_attente, liste_des_skus, premier_sku_actif, liste_skus_actifs).
    pub async fn get_queue_info(&self) -> (usize, Vec<String>, Option<String>, Vec<String>) {
        let queue = self.queue.lock().await;
        let pending_skus: Vec<String> = queue.iter().map(|t| t.sku.clone()).collect();
        let pending_count = pending_skus.len();
        drop(queue);
        let active = self.active_skus.lock().await.clone();
        let first_active = active.first().cloned();
        (pending_count, pending_skus, first_active, active)
    }

    /// Retourne le premier SKU activement en cours de scraping.
    pub async fn get_active_sku(&self) -> Option<String> {
        self.active_skus.lock().await.first().cloned()
    }

    /// Récupère le statut d'une tâche.
    pub async fn get_status(&self, sku: &str) -> Option<TaskStatus> {
        let sku_upper = sku.to_uppercase();
        
        // En cours?
        let active = self.active_skus.lock().await;
        if active.contains(&sku_upper) {
            let np = self.network_path.lock().await.clone();
            if let Some(c) = crate::scraper_candidates::load_candidates(&np, &sku_upper) {
                return Some(TaskStatus {
                    sku: sku_upper,
                    status: c.status,
                    progress: c.progress,
                    message: "En cours...".to_string(),
                });
            }
        }
        drop(active);

        // En file d'attente?
        let queue = self.queue.lock().await;
        if queue.iter().any(|t| t.sku == sku_upper) {
            return Some(TaskStatus {
                sku: sku_upper,
                status: ScrapeStatus::Pending,
                progress: 0.0,
                message: "En attente...".to_string(),
            });
        }
        drop(queue);

        // Terminé / dans le cache?
        let np = self.network_path.lock().await.clone();
        if let Some(c) = crate::scraper_candidates::load_candidates(&np, &sku_upper) {
            return Some(TaskStatus {
                sku: sku_upper,
                status: c.status,
                progress: c.progress,
                message: format!("{} candidats", c.total_candidates()),
            });
        }

        None
    }

    async fn start_worker_if_needed(&self) {
        let mut active_workers = self.active_workers.lock().await;
        let queue_len = {
            let q = self.queue.lock().await;
            q.len()
        };
        if queue_len == 0 {
            return;
        }

        let max_workers = 3;
        while *active_workers < max_workers && *active_workers < queue_len {
            *active_workers += 1;

            let queue = self.queue.clone();
            let active_skus = self.active_skus.clone();
            let cancel_tokens = self.cancel_tokens.clone();
            let active_workers_clone = self.active_workers.clone();
            let app_handle = self.app_handle.clone();
            let network_path = self.network_path.clone();

            tokio::spawn(async move {
                loop {
                    // Prendre la prochaine tâche
                    let task = {
                        let mut q = queue.lock().await;
                        q.pop_front()
                    };

                    let task = match task {
                        Some(t) => t,
                        None => {
                            let mut w = active_workers_clone.lock().await;
                            if *w > 0 {
                                *w -= 1;
                            }
                            break;
                        }
                    };

                    // Marquer comme active
                    {
                        let mut active = active_skus.lock().await;
                        active.push(task.sku.clone());
                    }

                    let np = network_path.lock().await.clone();

                    // Exécuter le scraping
                    let result = crate::scraper_engine::scrape_all_for_sku(
                        &app_handle,
                        &task.sku,
                        &np,
                        task.cancel_token.clone(),
                        task.params,
                    ).await;

                    // Nettoyer active list & token
                    {
                        let mut active = active_skus.lock().await;
                        active.retain(|s| s != &task.sku);
                    }
                    {
                        let mut tokens = cancel_tokens.lock().await;
                        tokens.remove(&task.sku);
                    }

                    // Émettre événement de fin
                    use tauri::Emitter;
                    match result {
                        Ok(candidates) => {
                            let _ = app_handle.emit("scrape-task-complete", serde_json::json!({
                                "sku": task.sku,
                                "candidates_count": candidates.total_candidates(),
                                "status": "complete",
                            }));
                        }
                        Err(err) => {
                            let _ = app_handle.emit("scrape-task-error", serde_json::json!({
                                "sku": task.sku,
                                "error": err,
                            }));
                        }
                    }

                    // Petit délai entre les tâches pour être respectueux
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            });
        }
    }
}
