#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

APP_PATH = r"d:\Code Projects\Stockflow\src\App.tsx"

with open(APP_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

OLD_STATE = """  const [confirmModal, setConfirmModal] = useState<ConfirmModalConfig | null>(null);
  const [alertModal, setAlertModal] = useState<AlertModalConfig | null>(null);"""

NEW_STATE = """  const [confirmModal, setConfirmModal] = useState<ConfirmModalConfig | null>(null);
  const [inlineConfirm, setInlineConfirm] = useState<{ id: string, action: () => void } | null>(null);
  const [alertModal, setAlertModal] = useState<AlertModalConfig | null>(null);"""

if OLD_STATE in content:
    content = content.replace(OLD_STATE, NEW_STATE, 1)
    print("[OK] State inlineConfirm injecté")
else:
    print("[WARN] State inlineConfirm non injecté")

with open(APP_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
