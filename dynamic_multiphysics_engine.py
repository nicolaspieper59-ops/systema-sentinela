#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS GENERATOR
Générateur d'éphémérides Tchebychev haute précision depuis JPL DE440s
"""

import argparse
import sys
import json
import time
import os
import numpy as np

try:
    from skyfield.api import load
except ImportError:
    print("[ERREUR] La bibliothèque skyfield est requise. Installez-la via `pip install skyfield`", file=sys.stderr)
    sys.exit(1)

# Cartographie des corps JPL DE440s
CORPS_MAP = {
    "SOLEIL": "sun",
    "LUNE": "moon",
    "MERCURE": "mercury",
    "VENUS": "venus",
    "MARS": "mars",
    "JUPITER": "jupiter barycenter",
    "SATURNE": "saturn barycenter",
    "URANUS": "uranus barycenter",
    "NEPTUNE": "neptune barycenter"
}

# Découpage temporel adaptatif (heures par bloc de Tchebychev)
PAS_HEURES_MAP = {
    "LUNE": 4,
    "MERCURE": 6,
    "SOLEIL": 12,
    "VENUS": 12,
    "MARS": 12,
    "JUPITER": 24,
    "SATURNE": 24,
    "URANUS": 48,
    "NEPTUNE": 48
}

DEGRE_TCHEBYCHEV = 10

def calculer_segment_tchebychev(earth, astre_target, ts, t1_unix, t2_unix, degre=10):
    """Calcule les coefficients de Tchebychev sur les nœuds de Gauss-Lobatto pour un intervalle donné."""
    nodes_std = np.cos(np.pi * np.arange(degre + 1) / degre)
    
    # Interpolation temporelle des nœuds
    t_sec_nodes = 0.5 * (t2_unix - t1_unix) * nodes_std + 0.5 * (t2_unix + t1_unix)
    times_nodes = ts.tt_jd((t_sec_nodes / 86400.0) + 2440587.5)
    
    # Calcul des positions géocentriques ECEF/ICRF en km
    astrometric = earth.at(times_nodes).observe(astre_target)
    pos_km = astrometric.position.km  # Matrice (3, N)
    
    # Fit des polynômes de Tchebychev sur [-1, 1]
    cx = np.polynomial.chebyshev.chebfit(nodes_std, pos_km[0], degre).tolist()
    cy = np.polynomial.chebyshev.chebfit(nodes_std, pos_km[1], degre).tolist()
    cz = np.polynomial.chebyshev.chebfit(nodes_std, pos_km[2], degre).tolist()

    return {
        "t_start": t1_unix,
        "t_end": t2_unix,
        "cx": cx,
        "cy": cy,
        "cz": cz,
        "mag": 0.0
    }

def generer_ephemerides(bsp_path, days=7, output_path="flux_live.json"):
    if not os.path.exists(bsp_path):
        raise FileNotFoundError(f"Fichier de noyau JPL introuvable : {bsp_path}")

    ts = load.timescale()
    eph = load(bsp_path)
    earth = eph['earth']

    t_start_unix = time.time()
    t_end_unix = t_start_unix + (days * 86400)

    data_output = {}

    for nom_corps, target_key in CORPS_MAP.items():
        astre = eph[target_key]
        pas_sec = PAS_HEURES_MAP.get(nom_corps, 12) * 3600.0

        segments = []
        curr_t = t_start_unix

        while curr_t < t_end_unix:
            next_t = min(curr_t + pas_sec, t_end_unix)
            seg = calculer_segment_tchebychev(earth, astre, ts, curr_t, next_t, DEGRE_TCHEBYCHEV)
            segments.append(seg)
            curr_t = next_t

        data_output[nom_corps] = segments

    resultat_global = {
        "ALMANACH": {
            "generateur": "Systema Sentinela DE440s Generator",
            "date_creation_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "fenetre_jours": days
        },
        "DATA": data_output
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(resultat_global, f, indent=2, ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser(description="Générateur de flux d'éphémérides DE440s")
    parser.add_argument("lat", type=float, help="Latitude station")
    parser.add_argument("lon", type=float, help="Longitude station")
    parser.add_argument("alt", type=float, help="Altitude station")
    parser.add_argument("--days", type=int, default=7, help="Période couverte en jours")
    parser.add_argument("--bsp", type=str, default="de440s.bsp", help="Chemin vers le fichier de440s.bsp")
    parser.add_argument("--out", type=str, default="flux_live.json", help="Fichier JSON de sortie")

    args = parser.parse_args()

    try:
        generer_ephemerides(args.bsp, days=args.days, output_path=args.out)
        print(f"[SUCCÈS] Flux éphémérides généré avec succès dans {args.out}")
        sys.exit(0)
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Échec de génération : {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
