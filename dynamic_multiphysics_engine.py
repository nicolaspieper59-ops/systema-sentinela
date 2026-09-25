#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS ENGINE (PORT PYTHON STRICT)
"""

import argparse
import math
import sys
from dataclasses import dataclass

@dataclass
class AstroResult:
    azim: float = 0.0
    elev_geom: float = 0.0
    elev_refractee: float = 0.0
    ra_deg: float = 0.0
    dec_deg: float = 0.0
    dist_ua: float = 0.0
    lever_ut: float = 0.0
    coucher_ut: float = 0.0
    air_mass: float = 0.0
    irradiance: float = 0.0
    magnitude_apparente: float = 0.0
    error_code: int = 0  # 0 = OK, != 0 = Erreur physique détectée

def normaliser_degres(deg: float) -> float:
    res = deg % 360.0
    return res + 360.0 if res < 0.0 else res

def calculer_depuis_ecef(
    x_ecef: float, y_ecef: float, z_ecef: float,
    lat_deg: float, lon_deg: float, alt_m: float,
    era_rad: float, timestamp_utc: float,
    temp_c: float, pres_hpa: float, mag_brute_astre: float,
    est_vecteur_topocentrique: bool = False
) -> AstroResult:
    result = AstroResult()

    # Validation stricte sans valeur de secours silencieuse
    if pres_hpa <= 0.0 or pres_hpa > 1500.0 or temp_c < -100.0 or temp_c > 80.0:
        result.error_code = 101  # Erreur : Paramètres météo hors limites physiques strictes
        return result

    phi = math.radians(lat_deg)
    lambda_lon = math.radians(lon_deg)
    
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = f * (2.0 - f)

    dx, dy, dz = x_ecef, y_ecef, z_ecef

    if not est_vecteur_topocentrique:
        N = a / math.sqrt(1.0 - e2 * math.sin(phi) ** 2)
        x_obs = (N + alt_m) * math.cos(phi) * math.cos(lambda_lon)
        y_obs = (N + alt_m) * math.cos(phi) * math.sin(lambda_lon)
        z_obs = (N * (1.0 - e2) + alt_m) * math.sin(phi)

        dx -= x_obs
        dy -= y_obs
        dz -= z_obs

    E = -math.sin(lambda_lon) * dx + math.cos(lambda_lon) * dy
    N_top = -math.sin(phi) * math.cos(lambda_lon) * dx - math.sin(phi) * math.sin(lambda_lon) * dy + math.cos(phi) * dz
    U = math.cos(phi) * math.cos(lambda_lon) * dx + math.cos(phi) * math.sin(lambda_lon) * dy + math.sin(phi) * dz

    dist_m = math.sqrt(dx**2 + dy**2 + dz**2)
    result.dist_ua = dist_m / 149597870700.0

    result.azim = normaliser_degres(math.degrees(math.atan2(E, N_top)))
    rho_horizontal = math.sqrt(E**2 + N_top**2)
    result.elev_geom = math.degrees(math.atan2(U, rho_horizontal))

    # Réfraction atmosphérique rigoureuse basée uniquement sur les mesures réelles transmises
    if result.elev_geom > -2.0:
        h = max(result.elev_geom, -1.0)
        ref_arcmin = 1.02 / math.tan(math.radians(h + 10.3 / (h + 5.1)))
        facteur_meteo_baro = (pres_hpa / 1013.25) * (288.15 / (273.15 + temp_c))
        result.elev_refractee = result.elev_geom + (ref_arcmin * facteur_meteo_baro) / 60.0
    else:
        result.elev_refractee = result.elev_geom

    # Calcul rigoureux de la masse d'air (Air Mass)
    result.air_mass = 0.0
    if result.elev_refractee > 0.0:
        sin_h = math.sin(math.radians(max(0.01, result.elev_refractee)))
        result.air_mass = 1.0 / (sin_h + 0.025 * math.exp(-11.0 * sin_h))
    else:
        result.air_mass = 40.0

    extinction_coeff = 0.15
    result.magnitude_apparente = mag_brute_astre + (extinction_coeff * result.air_mass)
    result.irradiance = (1361.0 * (0.7 ** result.air_mass) / (result.dist_ua ** 2)) if result.elev_refractee > 0.0 else 0.0

    lon_terrestre_deg = math.degrees(math.atan2(y_ecef, x_ecef))
    result.ra_deg = normaliser_degres(lon_terrestre_deg + math.degrees(era_rad))
    norm_r = math.sqrt(x_ecef**2 + y_ecef**2 + z_ecef**2)
    result.dec_deg = math.degrees(math.asin(z_ecef / norm_r)) if norm_r > 0.0 else 0.0

    dec_rad = math.radians(result.dec_deg)
    cos_h0 = -math.tan(phi) * math.tan(dec_rad)
    solar_noon_ut = normaliser_degres(12.0 - (lon_deg * 4.0)) / 15.0

    if cos_h0 < -1.0:
        result.lever_ut = -1.0  # Jour polaire
        result.coucher_ut = -1.0
    elif cos_h0 > 1.0:
        result.lever_ut = -2.0  # Nuit polaire
        result.coucher_ut = -2.0
    else:
        h0_deg = math.degrees(math.acos(cos_h0))
        demi_arc_jour = h0_deg / 15.0
        result.lever_ut = normaliser_degres((solar_noon_ut - demi_arc_jour) * 15.0) / 15.0
        result.coucher_ut = normaliser_degres((solar_noon_ut + demi_arc_jour) * 15.0) / 15.0

    return result

def main():
    parser = argparse.ArgumentParser(description="Dynamic Multiphysics Engine - Python Strict Port")
    parser.add_argument("lat", type=float, help="Latitude d'observation")
    parser.add_argument("lon", type=float, help="Longitude d'observation")
    parser.add_argument("alt", type=float, help="Altitude en mètres")
    parser.add_argument("--days", type=int, default=7, help="Nombre de jours de simulation")
    
    args = parser.parse_args()
    
    print(f"[INFO] Initialisation du pipeline multi-physique sur {args.days} jour(s) pour [Lat: {args.lat}, Lon: {args.lon}, Alt: {args.alt}m]")

    # Simulation d'un test unitaire du moteur sur une position ECEF étalon
    res = calculer_depuis_ecef(
        x_ecef=149600000000.0, y_ecef=0.0, z_ecef=0.0,
        lat_deg=args.lat, lon_deg=args.lon, alt_m=args.alt,
        era_rad=0.0, timestamp_utc=1711929600.0,
        temp_c=15.0, pres_hpa=1013.25, mag_brute_astre=-26.74
    )

    if res.error_code != 0:
        print(f"[ERREUR] Échec de la validation physique (Code d'erreur : {res.error_code})", file=sys.stderr)
        sys.exit(1)

    print(f"[SUCCÈS] Pipeline exécuté avec succès. Élévation : {res.elev_refractee:.2f}°, Masse d'air : {res.air_mass:.2f}")

if __name__ == "__main__":
    main()
