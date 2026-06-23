# Rappel du Prompt Initial pour la Suite de Test E2E

Mets en place un test E2E qui test à la fois une référence RS, mais aussi une référence de chaque autre site de VPC supporté.
Puis une référence sans site VPC qui utilise le fallback searxng.

Après ces tests, fait une analyse de ce qui a fonctionné et de ce qui n'a pas fonctionner. Ne te contente pas des écriture en DB pour valider les test, utilise des impression d'écran pour comparé optiquement les pages exploré et les informations récupéré en DB.

Confirme que tu vérifie aussi que le maximum d'informations dans chaque article soit remplit. Si elle ne le sont pas, tu cherchera pourquoi. Par exemple parfois il faut cliquer sur un bouton dans la page pour afficher un panneau ou un onglet qui contiendrait des informations à scrappé supplémentaire

Test aussi le scrap d'image produit et PDF pour chaque références testé.

N'oublie pas que pour les images et PDF, un modale s'affiche pour demander une validation à l'opérateur. Mais un système automatique existe aussi quand on utilise les cases à cocher sur plusieurs articles pour un scrap multi-références. Ces deux fonctions doivent être testés.

Tu as toutes les ressources avec le code de l'appli sous la main pour anticiper les blocages pendant le test parcequ'on attend une input utilisateur

Itère jusqu'à l'obtention d'un test qui fonctionne à 100% puis analyse les données. Cherche les axes d'améliorations.

Pour gagner du temps sur l'analyse du test, créer des portes de sorties quand le scrapper renvoie une erreur afin de la corriger, pour ensuite avancer étape par étape.

Par exemple si un site VPC n'ouvre pas la page produit, donc les données saisie ne correspondent pas a un produit, ou si le scrapper renvoie une erreur ou ne trouve rien dans les champs à remplir (dimension, marques, descriptions, etc), investigue pour savoir si c'est normale et OK de continuer.
