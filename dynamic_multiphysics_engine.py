
#!/usr/bin/env python3

import argparse
import sys
import json
import time
import os
import traceback
import datetime
import numpy as np

try:
    from skyfield.api import load, wgs84
except ImportError:
    print("[FATAL] Skyfield introuvable (`pip install skyfield numpy`).", file=sys.stderr)
    sys.exit(1)

CORPS_MAP = {
    "SOLEIL": ["sun", 10],
    "LUNE": ["moon", 301],
    "TERRE": ["earth", 399],
    "MERCURE": ["mercury barycenter", "mercury", 1],
    "VENUS": ["venus barycenter", "venus", 2],
    "MARS": ["mars barycenter", "mars", 4],
    "JUPITER": ["jupiter barycenter", 5],
    "SATURNE": ["saturn barycenter", 6],
    "URANUS": ["uranus barycenter", 7],
    "NEPTUNE": ["neptune barycenter", 8]
}

# Résolution temporelle maximale (pas de 30 min pour les planètes, 1 min pour Soleil/Lune)
PAS_HEURES_MAP = {
    "SOLEIL": 1.0 / 60.0,
    "LUNE": 1.0 / 60.0,
    "TERRE": 0.5,
    "MERCURE": 0.5,
    "VENUS": 0.5,
    "MARS": 0.5,
    "JUPITER": 0.5,
    "SATURNE": 0.5,
    "URANUS": 1.0,
    "NEPTUNE": 1.0
}

RAYONS_EQUATORIAUX_KM = {
    "SOLEIL": 696340.0, "LUNE": 1737.4, "TERRE": 6378.137, "MERCURE": 2439.7, "VENUS": 6051.8,
    "MARS": 3396.2, "JUPITER": 71492.0, "SATURNE": 60268.0, "URANUS": 25559.0, "NEPTUNE": 24764.0
}

PARAMETRES_ORBITAUX = {
    "SOLEIL":  {"perihelion_ua": 0.98329, "aphelion_ua": 1.01710, "perigee_ua": 0.98329, "period_days": 365.256, "lod_hours": 609.6, "vel_kms": 0.0},
    "LUNE":    {"perihelion_ua": 0.00240, "aphelion_ua": 0.00271, "perigee_ua": 0.00243, "period_days": 27.321, "lod_hours": 655.7, "vel_kms": 1.022},
    "TERRE":   {"perihelion_ua": 0.98329, "aphelion_ua": 1.01710, "perigee_ua": 0.98329, "period_days": 365.256, "lod_hours": 23.93, "vel_kms": 29.78},
    "MERCURE": {"perihelion_ua": 0.30750, "aphelion_ua": 0.46670, "perigee_ua": 0.54900, "period_days": 87.969, "lod_hours": 4222.6, "vel_kms": 47.36},
    "VENUS":   {"perihelion_ua": 0.71840, "aphelion_ua": 0.72820, "perigee_ua": 0.26400, "period_days": 224.701, "lod_hours": 2802.0, "vel_kms": 35.02},
    "MARS":    {"perihelion_ua": 1.38140, "aphelion_ua": 1.66600, "perigee_ua": 0.37200, "period_days": 686.980, "lod_hours": 24.62, "vel_kms": 24.07},
    "JUPITER": {"perihelion_ua": 4.95030, "aphelion_ua": 5.45700, "perigee_ua": 3.95000, "period_days": 4332.59, "lod_hours": 9.93, "vel_kms": 13.07},
    "SATURNE": {"perihelion_ua": 9.04120, "aphelion_ua": 10.12380, "perigee_ua": 8.05000, "period_days": 10759.22, "lod_hours": 10.7, "vel_kms": 9.68},
    "URANUS":  {"perihelion_ua": 18.28610, "aphelion_ua": 20.09650, "perigee_ua": 17.29000, "period_days": 30688.50, "lod_hours": 17.2, "vel_kms": 6.80},
    "NEPTUNE": {"perihelion_ua": 29.81000, "aphelion_ua": 30.32710, "perigee_ua": 28.81000, "period_days": 60182.00, "lod_hours": 16.1, "vel_kms": 5.43}
}

DEGRE_TCHEBYCHEV = 16  # Degré maximal pour une précision sub-milliseconde absolue
UA_KM = 149597870.7
LUNE_DIST_MOYENNE_KM = 384400.0

def extraire_donnees_iers_finals(fichier_path="finals2000A.all"):
    if not os.path.exists(fichier_path):
        return {"xp_arcsec": 0.05, "yp_arcsec": 0.12, "ut1_utc_sec": -0.0547}
    xp, yp, ut1_utc = 0.05, 0.12, -0.0547
    try:
        with open(fichier_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if lines:
                last_line = lines[-1]
                if len(last_line) >= 68:
                    xp = float(last_line[18:27].strip())
                    yp = float(last_line[37:46].strip())
                    ut1_utc = float(last_line[58:68].strip())
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
    raise KeyError(f"Astre non trouvé dans le BSP : {noms}")

def calculer_magnitude_apparente(nom_corps, pos_astre_topo_km, pos_soleil_topo_km):
    if nom_corps == "SOLEIL":
        return -26.74
    r_AE = -pos_astre_topo_km
    r_AS = pos_soleil_topo_km - pos_astre_topo_km
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
        dist_corr = 5.0 * np.log10(norm_AE / LUNE_DIST_MOYENNE_KM)
        return round(float(-12.73 + 0.026 * alpha_clamp + 4.0e-9 * (alpha_clamp**4) + dist_corr), 2)

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

def calculer_segment_tchebychev(earth, observer_topo, astre_target, sun_target, ts, t1_tt_unix, t2_tt_unix, nom_corps, degre=16):
    nodes_std = np.cos(np.pi * np.arange(degre + 1) / degre)
    t_tt_sec_nodes = 0.5 * (t2_tt_unix - t1_tt_unix) * nodes_std + 0.5 * (t2_tt_unix + t1_tt_unix)
    times_nodes = ts.tt_jd((t_tt_sec_nodes / 86400.0) + 2440587.5)

    earth_at = earth.at(times_nodes)
    obs = earth_at.observe(astre_target)

    pos_km = obs.position.km
    vel_kms = obs.velocity.km_per_s
    earth_vel_kms = earth_at.velocity.km_per_s

    cx = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[0], degre)]
    cy = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[1], degre)]
    cz = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[2], degre)]

    cvx = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[0], degre)]
    cvy = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[1], degre)]
    cvz = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[2], degre)]

    evx = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, earth_vel_kms[0], degre)]
    evy = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, earth_vel_kms[1], degre)]
    evz = [round(float(v), 12) for v in np.polynomial.chebyshev.chebfit(nodes_std, earth_vel_kms[2], degre)]

    t_mid_tt = 0.5 * (t1_tt_unix + t2_tt_unix)
    time_mid = ts.tt_jd((t_mid_tt / 86400.0) + 2440587.5)

    pos_astre_mid = observer_topo.at(time_mid).observe(astre_target).apparent().position.km
    pos_soleil_mid = observer_topo.at(time_mid).observe(sun_target).apparent().position.km
    mag_val = calculer_magnitude_apparente(nom_corps, pos_astre_mid, pos_soleil_mid)

    orb = PARAMETRES_ORBITAUX.get(nom_corps, {})

    return {
        "t_start": float(t1_tt_unix),
        "t_end": float(t2_tt_unix),
        "time_scale": "TT",
        "pre_corrected_ab": 0,
        "rayon_km": float(RAYONS_EQUATORIAUX_KM.get(nom_corps, 0.0)),
        "cx": cx, "cy": cy, "cz": cz,
        "cvx": cvx, "cvy": cvy, "cvz": cvz,
        "evx": evx, "evy": evy, "evz": evz,
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
    observer_topo = earth + wgs84.latlon(lat, lon, elevation_m=alt)

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    midnight_utc = datetime.datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=datetime.timezone.utc)
    t_skyfield_start = ts.from_datetime(midnight_utc)
    t_start_tt_unix = (t_skyfield_start.tt - 2440587.5) * 86400.0
    t_end_tt_unix = t_start_tt_unix + (nb_jours * 86400.0)

    data_output = {}

    for nom_corps, cibles in CORPS_MAP.items():
        astre = obtenir_astre(eph, cibles)
        pas_sec = PAS_HEURES_MAP.get(nom_corps, 1.0) * 3600.0
        segments = []
        curr_t = t_start_tt_unix
        while curr_t < t_end_tt_unix:
            next_t = min(curr_t + pas_sec, t_end_tt_unix)
            seg = calculer_segment_tchebychev(
                earth, observer_topo, astre, sun_target, ts, curr_t, next_t, nom_corps, DEGRE_TCHEBYCHEV
            )
            segments.append(seg)
            curr_t = next_t
        data_output[nom_corps] = segments

    eop_data = extraire_donnees_iers_finals()
    resultat_global = {
        "ALMANACH": {
            "generateur": "Systema Sentinela DE440s Kernel High-Res (Rigorous v20.0 - Max Precision)",
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
    parser = argparse.ArgumentParser(description="Générateur d'éphémérides JPL DE440s Rigoureux Max")
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
        print("[ERREUR FATALE] Échec Python :", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
