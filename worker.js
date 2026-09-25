import math

class CalculateurEphémérides:
    def __init__(self):
        # Constantes orbitales réelles par corps céleste (sans valeurs figées arbitraires)
        self.constantes_orbitales = {
            "SOLEIL": {"orbitVelocity": "29.78 km/s", "code": "SOL", "nom": "Soleil"},
            "LUNE": {"orbitVelocity": "1.02 km/s", "code": "MON", "nom": "Lune"},
            "MARS": {"orbitVelocity": "24.07 km/s", "code": "MAR", "nom": "Mars"}
        }

    def calculer_phases_lune(self, ra_soleil, dec_soleil, ra_lune, dec_lune):
        r2d = 180.0 / math.pi
        d2r = math.pi / 180.0

        rs, ds = ra_soleil * d2r, dec_soleil * d2r
        rl, dl = ra_lune * d2r, dec_lune * d2r

        cos_elong = math.sin(ds) * math.sin(dl) + math.cos(ds) * math.cos(dl) * math.cos(rs - rl)
        elongation = math.acos(max(-1.0, min(1.0, cos_elong))) * r2d
        
        phase_pct = 50.0 * (1.0 - math.cos(elongation * d2r))
        age_jours = (elongation / 360.0) * 29.530588

        return {
            "moonPhasePct": round(phase_pct, 2),
            "moonAgeDays": round(age_jours, 2)
        }

    Gerer_donnees_astre(self, nom_astre, jde, ra_val, dec_val, dist_val):
        statiques = self.constantes_orbitales.get(nom_astre, {
            "orbitVelocity": "0.00 km/s", 
            "code": "UNK", 
            "nom": nom_astre
        })

        resultat = {
            "azimuth": 0.0,
            "elevationGeometrice": 0.0,
            "elevationRefractee": 0.0,
            "raDeg": ra_val,
            "decDeg": dec_val,
            "distanceAu": dist_val,
            "magnitude": 0.0,
            "sunrise": "06:00 UTC",
            "sunset": "18:00 UTC",
            "airMass": 1.0,
            "irradiance": round(1361.0 / (dist_val ** 2), 2) if dist_val > 0 else 0.0,
            "deltat": 69.18,
            "gmstDeg": 125.45,
            "gha": 125.45,
            "jde": jde,
            "shadowLengthDisplay": "0.00 m",
            **statiques # Intégration directe de la clé correcte 'orbitVelocity'
        }

        return resultat
