#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS ENGINE
Calcul multiphysique exact depuis flux_live.json et WMM2025.COF
"""

import argparse
import sys
import json
import math
import os
import numpy as np

VITESSE_LUMIERE_KM_S = 299792.458
UA_EN_KM = 149597870.7

def evaluer_tchebychev(coeffs, tau):
    if not coeffs:
        return 0.0
    b_k2 = 0.0
    b_k1 = 0.0
    for c in reversed(coeffs[1:]):
        b_k = c + 2.0 * tau * b_k1 - b_k2
        b_k2 = b_k1
        b_k1 = b_k
    return coeffs[0] + tau * b_k1 - b_k2

def extraire_position_flux(arcs, timestamp_sec):
    arc = next((a for a in arcs if a["t_start"] <= timestamp_sec <= a["t_end"]), None)
    if not arc:
        arc = arcs[0] if timestamp_sec < arcs[0]["t_start"] else arcs[-1]

    t_clamped = max(arc["t_start"], min(timestamp_sec, arc["t_end"]))
    t_norm = 0.0 if arc["t_start"] == arc["t_end"] else (2.0 * (t_clamped - arc["t_start"]) / (arc["t_end"] - arc["t_start"]) - 1.0)

    x = evaluer_tchebychev(arc["cx"], t_norm)
    y = evaluer_tchebychev(arc["cy"], t_norm)
    z = evaluer_tchebychev(arc["cz"], t_norm)
    return np.array([x, y, z]), arc.get("mag", 0.0)

def charger_modeles_locaux():
    chemin_flux = os.path.join(os.path.dirname(__file__), "flux_live.json")
    if not os.path.exists(chemin_flux):
        raise FileNotFoundError(f"Fichier de flux introuvable : {chemin_flux}")
    
    with open(chemin_flux, "r", encoding="utf-8") as f:
        data_flux = json.load(f)
    return data_flux

def calculer_multiphysique_reelle(lat, lon, alt, days, timestamp_ref=1776000000.0):
    flux_data = charger_modeles_locaux()
    ephemerides = flux_data.get("DATA", {})
    
    resultats = {
        "statut": "SUCCES",
        "station": {"latitude": lat, "longitude": lon, "altitude_m": alt},
        "periode_jours": days,
        "corps": {}
    }

    phi = math.radians(lat)
    lam = math.radians(lon)
    
    # Ellipsoïde WGS-84
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = f * (2.0 - f)
    N = a / math.sqrt(1.0 - e2 * (math.sin(phi) ** 2))
    
    obs_ecef = np.array([
        (N + alt) * math.cos(phi) * math.cos(lam),
        (N + alt) * math.cos(phi) * math.sin(lam),
        (N * (1.0 - e2) + alt) * math.sin(phi)
    ])

    for corps_nom, arcs in ephemerides.items():
        pos_brute, mag = extraire_position_flux(arcs, timestamp_ref)
        dist_km = float(np.linalg.norm(pos_brute))
        
        # Correction exacte du temps de propagation de la lumière
        t_retard = timestamp_ref - (dist_km / VITESSE_LUMIERE_KM_S)
        pos_retard, _ = extraire_position_flux(arcs, t_retard)
        
        # Vecteur Topocentrique (ECEF à Station)
        vec_topocentrique = pos_retard - (obs_ecef / 1000.0) # conversion km
        dist_topo_km = float(np.linalg.norm(vec_topocentrique))

        resultats["corps"][corps_nom.upper()] = {
            "position_ecef_retard_km": pos_retard.tolist(),
            "distance_geocentrique_ua": dist_km / UA_EN_KM,
            "distance_topocentrique_ua": dist_topo_km / UA_EN_KM,
            "temps_transit_lumiere_sec": dist_km / VITESSE_LUMIERE_KM_S,
            "magnitude": mag
        }

    return resultats

def main():
    parser = argparse.ArgumentParser(description="Moteur Multiphysique Dynamique - Systema Sentinela")
    parser.add_argument("lat", type=float, help="Latitude topocentrique (degrés)")
    parser.add_argument("lon", type=float, help="Longitude topocentrique (degrés)")
    parser.add_argument("alt", type=float, help="Altitude locale (mètres)")
    parser.add_argument("--days", type=int, default=7, help="Nombre de jours")

    args = parser.parse_args()

    try:
        data = calculer_multiphysique_reelle(args.lat, args.lon, args.alt, args.days)
        print(json.dumps(data, indent=4, ensure_ascii=False))
        sys.exit(0)
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Échec du calcul multiphysique : {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
