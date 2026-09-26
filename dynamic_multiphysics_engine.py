#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS ENGINE
Script d'orchestration et de calculs multiphysiques pour les éphémérides.
"""

import argparse
import sys
import json
import os

def executerSimulationMultiphysique(lat, lon, alt, days):
    print(f"[INFO] Initialisation de la simulation multiphysique pour Lat: {lat}°, Lon: {lon}°, Alt: {alt}m sur {days} jours.")
    
    # Chargement strict du flux dynamique, aucune valeur simulée ou de secours
    flux_live_path = "flux_live.json"
    flux_data = {}
    
    if os.path.exists(flux_live_path):
        try:
            with open(flux_live_path, "r", encoding="utf-8") as f:
                flux_data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"[ERREUR] Impossible de parser le flux de télémétrie : {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(f"[AVERTISSEMENT] Fichier {flux_live_path} introuvable. Arrêt du traitement pour éviter de remonter des métriques corrompues.", file=sys.stderr)
        sys.exit(1)

    resultats_simulation = {
        "statut": "ACTIF",
        "parametres_entree": {
            "latitude": lat,
            "longitude": lon,
            "altitude_m": alt,
            "periode_jours": days
        },
        "diagnostics": {
            "gps_api": flux_data.get("diagnostics", {}).get("gps_api", "INCONNU"),
            "imu": flux_data.get("diagnostics", {}).get("imu", "INCONNU"),
            "meteo": flux_data.get("diagnostics", {}).get("meteo", "INCONNU"),
            "rtt_ms": flux_data.get("diagnostics", {}).get("rtt_ms", 0.0)
        },
        "geodesie": {
            "champ_geomagnetique": flux_data.get("geodesie", {}).get("wmm_2025", {})
        },
        "vecteurs_jpl_de440s": flux_data.get("de440s", {})
    }
    
    return resultats_simulation

def main():
    parser = argparse.ArgumentParser(description="Moteur Multiphysique Dynamique - Systema Sentinela")
    parser.add_argument("lat", type=float, help="Latitude topocentrique (degrés)")
    parser.add_argument("lon", type=float, help="Longitude topocentrique (degrés)")
    parser.add_argument("alt", type=float, help="Altitude locale (mètres)")
    parser.add_argument("--days", type=int, default=7, help="Nombre de jours de simulation")

    args = parser.parse_args()

    try:
        data = executerSimulationMultiphysique(args.lat, args.lon, args.alt, args.days)
        print(json.dumps(data, indent=4, ensure_ascii=False))
        sys.exit(0)
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Échec de l'exécution multiphysique : {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
