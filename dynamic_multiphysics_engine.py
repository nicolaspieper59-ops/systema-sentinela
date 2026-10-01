#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS GENERATOR (v20.2 Robust & Standardized)
Générateur d'éphémérides Tchebychev position + vitesse depuis JPL DE440s
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
    print("[ERREUR] La bibliothèque skyfield est requise (`pip install skyfield`)", file=sys.stderr)
    sys.exit(1)

CORPS_MAP = {
    "SOLEIL": ["sun"],
    "LUNE": ["moon"],
    "MERCURE": ["mercury", "mercury barycenter"],
    "VENUS": ["venus", "venus barycenter"],
    "MARS": ["mars barycenter", "mars"],
    "JUPITER": ["jupiter barycenter"],
    "SATURNE": ["saturn barycenter"],
    "URANUS": ["uranus barycenter"],
    "NEPTUNE": ["neptune barycenter"]
}

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

RAYONS_EQUATORIAUX_KM = {
    "SOLEIL": 696340.0,
    "LUNE": 1737.4,
    "MERCURE": 2439.7,
    "VENUS": 6051.8,
    "MARS": 3396.2,
    "JUPITER": 71492.0,
    "SATURNE": 60268.0,
    "URANUS": 25559.0,
    "NEPTUNE": 24764.0
}

DEGRE_TCHEBYCHEV = 10
UA_KM = 149597870.7

def valider_coordonnees_station(lat, lon, alt):
    """Vérifie la validité physique des coordonnées de la station."""
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"Latitude hors limites [-90, 90] : {lat}")
    if not (-180.0 <= lon <= 180.0):
        raise ValueError(f"Longitude hors limites [-180, 180] : {lon}")
    if not (-500.0 <= alt <= 100000.0):
        raise ValueError(f"Altitude hors limites [-500m, 100km] : {alt}")

def obtenir_astre(eph, noms_possibles):
    for nom in noms_possibles:
        if nom in eph:
            return eph[nom]
    raise KeyError(f"Aucune cible trouvée parmi : {noms_possibles}")

def calculer_inclinaison_anneaux_saturne(pos_saturne_km):
    ra_pole = np.radians(40.66)
    dec_pole = np.radians(83.54)
    n_pole = np.array([
        np.cos(dec_pole) * np.cos(ra_pole),
        np.cos(dec_pole) * np.sin(ra_pole),
        np.sin(dec_pole)
    ])
    norme = np.linalg.norm(pos_saturne_km)
    if norme == 0: 
        return 0.0
    v_terre_saturne = pos_saturne_km / norme
    sin_B = np.dot(-v_terre_saturne, n_pole)
    return np.arcsin(np.clip(sin_B, -1.0, 1.0))

def calculer_magnitude_apparente(nom_corps, pos_astre_km, pos_soleil_km):
    v_terre_astre = pos_astre_km
    delta_km = np.linalg.norm(v_terre_astre)
    delta_ua = delta_km / UA_KM

    v_soleil_astre = pos_astre_km - pos_soleil_km
    r_km = np.linalg.norm(v_soleil_astre)
    r_ua = r_km / UA_KM

    if r_km == 0 or delta_km == 0:
        return 0.0

    cos_alpha = np.dot(v_soleil_astre, v_terre_astre) / (r_km * delta_km)
    cos_alpha = np.clip(cos_alpha, -1.0, 1.0)
    alpha_deg = np.degrees(np.arccos(cos_alpha))

    if nom_corps == "SOLEIL":
        return -26.74

    if nom_corps == "LUNE":
        return round(float(-12.73 + 0.026 * alpha_deg + 4.0e-9 * (alpha_deg**4)), 2)

    if nom_corps == "SATURNE":
        B = calculer_inclinaison_anneaux_saturne(pos_astre_km)
        sin_B = np.sin(np.abs(B))
        mag = -8.88 + 5.0 * np.log10(r_ua * delta_ua) + 0.044 * alpha_deg - 2.6 * sin_B + 1.25 * (sin_B**2)
        return round(float(mag), 2)

    modeles = {
        "MERCURE": (-0.60, 0.0498 * alpha_deg - 0.0001556 * (alpha_deg**2) + 3.39e-9 * (alpha_deg**3)),
        "VENUS":   (-4.40, 0.0009 * alpha_deg + 0.000239 * (alpha_deg**2) - 6.5e-7 * (alpha_deg**3)),
        "MARS":    (-1.52, 0.016 * alpha_deg),
        "JUPITER": (-9.40, 0.005 * alpha_deg),
        "URANUS":  (-7.19, 0.001 * alpha_deg),
        "NEPTUNE": (-6.87, 0.001 * alpha_deg)
    }

    if nom_corps in modeles:
        v_0, corr_phase = modeles[nom_corps]
        mag = v_0 + 5.0 * np.log10(r_ua * delta_ua) + corr_phase
        return round(float(mag), 2)

    return 0.0

def calculer_segment_tchebychev(earth, astre_target, sun_target, ts, t1_unix, t2_unix, nom_corps, degre=10):
    nodes_std = np.cos(np.pi * np.arange(degre + 1) / degre)
    t_sec_nodes = 0.5 * (t2_unix - t1_unix) * nodes_std + 0.5 * (t2_unix + t1_unix)
    times_nodes = ts.tt_jd((t_sec_nodes / 86400.0) + 2440587.5)
    
    # Prise en compte de l'aberration de la lumière et du temps de transit avec .apparent()
    apparent_obs = earth.at(times_nodes).observe(astre_target).apparent()
    pos_km = apparent_obs.position.km
    vel_kms = apparent_obs.velocity.km_per_s

    cx = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[0], degre)]
    cy = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[1], degre)]
    cz = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[2], degre)]

    cvx = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[0], degre)]
    cvy = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[1], degre)]
    cvz = [float(val) for val in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[2], degre)]

    t_mid_unix = 0.5 * (t1_unix + t2_unix)
    time_mid = ts.tt_jd((t_mid_unix / 86400.0) + 2440587.5)
    
    pos_astre_mid = earth.at(time_mid).observe(astre_target).apparent().position.km
    pos_soleil_mid = earth.at(time_mid).observe(sun_target).apparent().position.km
    
    mag_val = calculer_magnitude_apparente(nom_corps, pos_astre_mid, pos_soleil_mid)

    return {
        "t_start": float(t1_unix),
        "t_end": float(t2_unix),
        "rayon_km": float(RAYONS_EQUATORIAUX_KM.get(nom_corps, 0.0)),
        "cx": cx, "cy": cy, "cz": cz,
        "cvx": cvx, "cvy": cvy, "cvz": cvz,
        "mag": float(mag_val)
    }

def generer_ephemerides(lat=43.284356, lon=5.358507, alt=49.81, nb_jours=7, bsp_path="de440s.bsp", fichier_sortie="flux_live.json"):
    valider_coordonnees_station(lat, lon, alt)

    if not os.path.exists(bsp_path):
        raise FileNotFoundError(f"Fichier BSP introuvable : {bsp_path}")

    ts = load.timescale()
    eph = load(bsp_path)
    earth = eph['earth']
    sun_target = eph['sun']

    t_start_unix = time.time()
    t_end_unix = t_start_unix + (nb_jours * 86400)

    data_output = {}

    for nom_corps, cibles_possibles in CORPS_MAP.items():
        astre = obtenir_astre(eph, cibles_possibles)
        pas_sec = PAS_HEURES_MAP.get(nom_corps, 12) * 3600.0

        segments = []
        curr_t = t_start_unix

        while curr_t < t_end_unix:
            next_t = min(curr_t + pas_sec, t_end_unix)
            seg = calculer_segment_tchebychev(
                earth, astre, sun_target, ts, curr_t, next_t, nom_corps, DEGRE_TCHEBYCHEV
            )
            segments.append(seg)
            curr_t = next_t

        data_output[nom_corps] = segments

    resultat_global = {
        "ALMANACH": {
            "generateur": "Systema Sentinela DE440s Generator (JPL-Grade)",
            "date_creation_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "fenetre_jours": nb_jours,
            "station": {
                "latitude": float(lat),
                "longitude": float(lon),
                "altitude_m": float(alt)
            }
        },
        "DATA": data_output
    }

    with open(fichier_sortie, "w", encoding="utf-8") as f:
        json.dump(resultat_global, f, indent=2, ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser(description="Générateur JPL-Grade")
    parser.add_argument("lat", type=float, help="Latitude de la station")
    parser.add_argument("lon", type=float, help="Longitude de la station")
    parser.add_argument("alt", type=float, help="Altitude de la station (mètres)")
    parser.add_argument("--days", type=int, default=7, help="Fenêtre temporelle en jours")
    parser.add_argument("--bsp", type=str, default="de440s.bsp", help="Chemin du fichier JPL BSP")
    parser.add_argument("--out", type=str, default="flux_live.json", help="Fichier JSON de sortie")

    args = parser.parse_args()

    try:
        generer_ephemerides(
            lat=args.lat,
            lon=args.lon,
            alt=args.alt,
            nb_jours=args.days,
            bsp_path=args.bsp,
            fichier_sortie=args.out
        )
        print(f"[SUCCÈS] Génération terminée dans {args.out}")
        sys.exit(0)
    except Exception as e:
        print(f"[ERREUR] {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
