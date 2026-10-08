#!/bin/bash
# ============================================================
# SMARTEC · Backup de usuarios de Firebase Auth
# Exporta UID, email, metadata a JSON.
# NO incluye contraseñas (eso requiere las claves de firma).
# ============================================================

PROJECT_ID="smartec-8fc19"
BACKUP_DIR="../backups/auth"
FECHA=$(date +%Y-%m-%d_%H%M%S)
ARCHIVO="${BACKUP_DIR}/auth_backup_${FECHA}.json"

# Crear carpeta si no existe
mkdir -p "$BACKUP_DIR"

echo "⏳ Exportando usuarios de Auth del proyecto $PROJECT_ID..."
echo ""

firebase auth:export "$ARCHIVO" --format=json --project "$PROJECT_ID"

# Verificar resultado
if [ -f "$ARCHIVO" ]; then
  TAMANO=$(du -h "$ARCHIVO" | cut -f1)
  echo ""
  echo "✅ Backup guardado en: $ARCHIVO ($TAMANO)"
else
  echo ""
  echo "❌ Error: no se generó el archivo."
fi