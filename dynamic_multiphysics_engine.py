#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS GENERATOR (JPL DE440s Rigorous Engine v19.30)
Mode Haute Résolution Adaptative (Précision Sub-Arcsecondique ~1440 pts/j équivalents)
"""

import argparse
import sys
import json
import time
import os
import traceback
import datetime
import numpy as np

try:
    from skyfield.api import load
except ImportError:
    print("[FATAL] Skyfield introuvable (`pip install skyfield numpy`).", file=sys.stderr)
    sys.exit(1)

CORPS_MAP = {
    "SOLEIL": ["sun", 10],
    "LUNE": ["moon", 301],
    "MERCURE": ["mercury barycenter", "mercury", 1],
    "VENUS": ["venus barycenter", "venus", 2],
    "MARS": ["mars barycenter", "mars", 4],
    "JUPITER": ["jupiter barycenter", 5],
    "SATURNE": ["saturn barycenter", 6],
    "URANUS": ["uranus barycenter", 7],
    "NEPTUNE": ["neptune barycenter", 8]
}

# Grille haute précision équivalente 1440 points/jour
PAS_HEURES_MAP = {
    "LUNE": 0.5,       # 1 segment toutes les 30 min (48 segments/jour)
    "MERCURE": 1,      # 1 segment par heure (24 segments/jour)
    "SOLEIL": 2,       # 1 segment toutes les 2h
    "VENUS": 2,        # 1 segment toutes les 2h
    "MARS": 3,         # 1 segment toutes les 3h
    "JUPITER": 6,      # 1 segment toutes les 6h
    "SATURNE": 6,      # 1 segment toutes les 6h
    "URANUS": 12,      # 1 segment toutes les 12h
    "NEPTUNE": 12      # 1 segment toutes les 12h
}

RAYONS_EQUATORIAUX_KM = {
    "SOLEIL": 696340.0, "LUNE": 1737.4, "MERCURE": 2439.7, "VENUS": 6051.8,
    "MARS": 3396.2, "JUPITER": 71492.0, "SATURNE": 60268.0, "URANUS": 25559.0, "NEPTUNE": 24764.0
}

# Paramètres orbitaux corrigés avec valeurs physiques réelles
PARAMETRES_ORBITAUX = {
    "SOLEIL":  {"perihelion_ua": 0.98329, "aphelion_ua": 1.01710, "perigee_ua": 0.98329, "period_days": 365.256, "lod_hours": 609.6, "vel_kms": 0.0},
    "LUNE":    {"perihelion_ua": 0.00240, "aphelion_ua": 0.00271, "perigee_ua": 0.00243, "period_days": 27.321, "lod_hours": 655.7, "vel_kms": 1.022},
    "MERCURE": {"perihelion_ua": 0.30750, "aphelion_ua": 0.46670, "perigee_ua": 0.54900, "period_days": 87.969, "lod_hours": 4222.6, "vel_kms": 47.36},
    "VENUS":   {"perihelion_ua": 0.71840, "aphelion_ua": 0.72820, "perigee_ua": 0.26400, "period_days": 224.701, "lod_hours": 2802.0, "vel_kms": 35.02},
    "MARS":    {"perihelion_ua": 1.38140, "aphelion_ua": 1.66600, "perigee_ua": 0.37200, "period_days": 686.980, "lod_hours": 24.62, "vel_kms": 24.07},
    "JUPITER": {"perihelion_ua": 4.95030, "aphelion_ua": 5.45700, "perigee_ua": 3.95000, "period_days": 4332.59, "lod_hours": 9.93, "vel_kms": 13.07},
    "SATURNE": {"perihelion_ua": 9.04120, "aphelion_ua": 10.12380, "perigee_ua": 8.05000, "period_days": 10759.22, "lod_hours": 10.7, "vel_kms": 9.68},
    "URANUS":  {"perihelion_ua": 18.28610, "aphelion_ua": 20.09650, "perigee_ua": 17.29000, "period_days": 30688.50, "lod_hours": 17.2, "vel_kms": 6.80},
    "NEPTUNE": {"perihelion_ua": 29.81000, "aphelion_ua": 30.32710, "perigee_ua": 28.81000, "period_days": 60182.00, "lod_hours": 16.1, "vel_kms": 5.43}
}

DEGRE_TCHEBYCHEV = 12
UA_KM = 149597870.7

def extraire_donnees_iers_finals(fichier_path="finals2000A.all"):
    if not os.path.exists(fichier_path):
        return {"xp_arcsec": 0.0, "yp_arcsec": 0.0, "ut1_utc_sec": 0.0}
    
    xp, yp, ut1_utc = 0.0, 0.0, 0.0
    try:
        with open(fichier_path, 'r', encoding='utf-8') as f:
            for line in f:
                if len(line) >= 68:
                    try:
                        xp_val = float(line[18:27].strip())
                        yp_val = float(line[37:46].strip())
                        ut1_val = float(line[58:68].strip())
                        if xp_val != 0.0 and yp_val != 0.0:
                            xp, yp, ut1_utc = xp_val, yp_val, ut1_val
                    except ValueError:
                        continue
    except Exception as e:
        print(f"[WARN IERS] Lecture {fichier_path} : {e}", file=sys.stderr)
        
    return {"xp_arcsec": xp, "yp_arcsec": yp, "ut1_utc_sec": ut1_utc}

def valider_coordonnees(lat, lon, alt):
    if not (-90.0 <= lat <= 90.0): raise ValueError(f"Latitude invalide : {lat}")
    if not (-180.0 <= lon <= 180.0): raise ValueError(f"Longitude invalide : {lon}")
    if not (-500.0 <= alt <= 100000.0): raise ValueError(f"Altitude invalide : {alt}")

def obtenir_astre(eph, noms):
    for nom in noms:
        if nom in eph: 
            return eph[nom]
    raise KeyError(f"Astre non trouvé dans le fichier BSP : {noms}")

def calculer_magnitude_apparente(nom_corps, pos_astre_km, pos_soleil_km):
    if nom_corps == "SOLEIL": 
        return -26.74

    r_AE = -pos_astre_km
    r_AS = pos_soleil_km - pos_astre_km
    
    norm_AE = np.linalg.norm(r_AE)
    norm_AS = np.linalg.norm(r_AS)

    if norm_AE == 0 or norm_AS == 0: 
        return 0.0

    delta_ua = norm_AE / UA_KM
    r_ua = norm_AS / UA_KM

    cos_alpha = np.dot(r_AE, r_AS) / (norm_AE * norm_AS)
    alpha_deg = np.degrees(np.arccos(np.clip(cos_alpha, -1.0, 1.0)))

    if nom_corps == "LUNE":
        alpha_clamp = np.clip(alpha_deg, 0.0, 180.0)
        return round(float(-12.73 + 0.026 * alpha_clamp + 4.0e-9 * (alpha_clamp**4)), 2)

    modeles = {
        "MERCURE": (-0.613, 0.06328 * alpha_deg - 0.0001633 * (alpha_deg**2) + 3.36e-7 * (alpha_deg**3)),
        "VENUS":   (-4.384, -0.00104 * alpha_deg + 0.00000368 * (alpha_deg**2) + 2.83e-13 * (alpha_deg**6)),
        "MARS":    (-1.520, 0.016 * alpha_deg),
        "JUPITER": (-9.400, 0.005 * alpha_deg),
        "SATURNE": (-8.880, 0.013 * alpha_deg),
        "URANUS":  (-7.190, 0.001 * alpha_deg),
        "NEPTUNE": (-6.870, 0.001 * alpha_deg)
    }

    if nom_corps in modeles:
        v_0, corr = modeles[nom_corps]
        return round(float(v_0 + 5.0 * np.log10(r_ua * delta_ua) + corr), 2)

    return 0.0

def calculer_segment_tchebychev(earth, astre_target, sun_target, ts, t1_unix, t2_unix, nom_corps, degre=12):
    nodes_std = np.cos(np.pi * np.arange(degre + 1) / degre)
    t_sec_nodes = 0.5 * (t2_unix - t1_unix) * nodes_std + 0.5 * (t2_unix + t1_unix)
    times_nodes = ts.tt_jd((t_sec_nodes / 86400.0) + 2440587.5)

    obs = earth.at(times_nodes).observe(astre_target)
    apparent_obs = obs.apparent()
    pos_km = apparent_obs.position.km

    try:
        vel_kms = apparent_obs.velocity.km_per_s
    except Exception:
        vel_kms = obs.velocity.km_per_s

    cx = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[0], degre)]
    cy = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[1], degre)]
    cz = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[2], degre)]

    cvx = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[0], degre)]
    cvy = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[1], degre)]
    cvz = [round(float(v), 8) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[2], degre)]

    t_mid_unix = 0.5 * (t1_unix + t2_unix)
    time_mid = ts.tt_jd((t_mid_unix / 86400.0) + 2440587.5)
    
    pos_astre_mid = earth.at(time_mid).observe(astre_target).apparent().position.km
    pos_soleil_mid = earth.at(time_mid).observe(sun_target).apparent().position.km
    mag_val = calculer_magnitude_apparente(nom_corps, pos_astre_mid, pos_soleil_mid)

    orb = PARAMETRES_ORBITAUX.get(nom_corps, {})

    return {
        "t_start": float(t1_unix),
        "t_end": float(t2_unix),
        "rayon_km": float(RAYONS_EQUATORIAUX_KM.get(nom_corps, 0.0)),
        "cx": cx, "cy": cy, "cz": cz,
        "cvx": cvx, "cvy": cvy, "cvz": cvz,
        "mag": float(mag_val),
        "perihelion_ua": float(orb.get("perihelion_ua", 0.0)),
        "aphelion_ua": float(orb.get("aphelion_ua", 0.0)),
        "perigee_ua": float(orb.get("perigee_ua", 0.0)),
        "period_days": float(orb.get("period_days", 0.0)),
        "lod_hours": float(orb.get("lod_hours", 0.0)),
        "vel_kms": float(orb.get("vel_kms", 0.0))
    }

def generer_ephemerides(lat, lon, alt, nb_jours, bsp_path, fichier_sortie):
    valider_coordonnees(lat, lon, alt)
    if not os.path.exists(bsp_path):
        raise FileNotFoundError(f"Éphémérides JPL introuvables : {bsp_path}")

    try:
        ts = load.timescale(builtin=True)
    except Exception:
        ts = load.timescale()

    eph = load(bsp_path)
    earth = obtenir_astre(eph, ["earth", 399, "earth barycenter", 3])
    sun_target = obtenir_astre(eph, ["sun", 10])

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    midnight_utc = datetime.datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=datetime.timezone.utc)
    t_start_unix = midnight_utc.timestamp()
    
    t_end_unix = t_start_unix + (nb_jours * 86400)
    data_output = {}

    for nom_corps, cibles in CORPS_MAP.items():
        astre = obtenir_astre(eph, cibles)
        pas_sec = PAS_HEURES_MAP.get(nom_corps, 6) * 3600.0
        segments = []
        curr_t = t_start_unix

        while curr_t < t_end_unix:
            next_t = min(curr_t + pas_sec, t_end_unix)
            seg = calculer_segment_tchebychev(earth, astre, sun_target, ts, curr_t, next_t, nom_corps, DEGRE_TCHEBYCHEV)
            segments.append(seg)
            curr_t = next_t

        data_output[nom_corps] = segments

    eop_data = extraire_donnees_iers_finals()

    resultat_global = {
        "ALMANACH": {
            "generateur": "Systema Sentinela DE440s Kernel High-Res",
            "date_creation_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "epoch_utc_ms": int(time.time() * 1000),
            "fenetre_jours": int(nb_jours),
            "station": {"latitude": float(lat), "longitude": float(lon), "altitude_m": float(alt)},
            "iers_eop": eop_data
        },
        "DATA": data_output
    }

    with open(fichier_sortie, "w", encoding="utf-8") as f:
        json.dump(resultat_global, f, separators=(',', ':'), ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser(description="Générateur d'éphémérides JPL DE440s Rigoureux High-Res")
    parser.add_argument("lat", type=float)
    parser.add_argument("lon", type=float)
    parser.add_argument("alt", type=float)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--bsp", type=str, default="de440s.bsp")
    parser.add_argument("--out", type=str, default="flux_live.json")

    args = parser.parse_args()
    try:
        generer_ephemerides(args.lat, args.lon, args.alt, args.days, args.bsp, args.out)
        print(f"[SUCCÈS] Flux généré : {args.out}")
    except Exception:
        print("[ERREUR FATALE] Échec du traitement Python :", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
