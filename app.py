#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v9.2.0 — BACKEND DE ROUTAGE ET CONTRÔLE MULTIPHYSIQUE
"""

import os
import json
import sys
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

app = FastAPI(title="SYSTEMA SENTINELA — ARCHITECTURE CENTRALISÉE")

# Répertoire de travail
BASE_DIR = os.getcwd()
FLUX_PATH = os.path.join(BASE_DIR, "flux_live.json")
INDEX_PATH = os.path.join(BASE_DIR, "index.html")

class ProfileModel(BaseModel):
    profile: str

@app.get("/", response_class=HTMLResponse)
def read_dashboard():
    """Sert l'interface de contrôle principale v8.5.8."""
    if not os.path.exists(INDEX_PATH):
        raise HTTPException(status_code=404, detail="Fichier index.html introuvable à la racine.")
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        return f.read()

@app.get("/flux_live.json")
def get_flux_live():
    """Route d'acquisition principale pour le script JS du tableau de bord."""
    if not os.path.exists(FLUX_PATH):
        # Renvoie une structure par défaut cohérente si le moteur n'a pas encore écrit
        return {
            "METADATA": {
                "infrastructure": "SYSTEMA SENTINELA — INITIALISING",
                "mode_environnement_execution": "OFFLINE_WAIT",
                "epoch_utc": "ATTENTE NOYAU...",
                "equation_of_time_min": 0.0,
                "eccentricity": 0.0167,
                "obliquity_deg": 23.44,
                "solar_longitude_deg": 0.0
            },
            "COUCHERS_LMT": {},
            "DATA_STREAMS": {}
        }
    with open(FLUX_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/set_profile")
def set_profile(data: ProfileModel):
    """Reçoit les ordres de changement de profil depuis la barre de contrôle HTML."""
    target_profile = data.profile.upper()
    valid_profiles = ["MARSEILLE_FIXE", "AVION", "TRAIN", "VOITURE", "BATEAU"]
    
    if target_profile not in valid_profiles:
        raise HTTPException(status_code=400, detail="Profil de déplacement non valide.")
    
    print(f"[CONTRÔLE] Ordre de bascule reçu vers le profil : {target_profile}")
    
    # Écrit l'état du profil choisi pour que le moteur asynchrone puisse le lire
    state_path = os.path.join(BASE_DIR, "active_profile.txt")
    with open(state_path, "w", encoding="utf-8") as f:
        f.write(target_profile)
        
    return {"status": "SUCCESS", "active_profile": target_profile}

if __name__ == "__main__":
    import uvicorn
    print("[ONLINE] Initialisation de l'API de routage sur http://127.0.0.1:8080")
    uvicorn.run(app, host="127.0.0.1", port=8080)
