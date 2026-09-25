#include <emscripten.h>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

extern "C" {

    /**
     * Calcule l'ensemble des éphémérides pour un astre donné à un instant JDE et un lieu donné.
     * Les résultats sont écrits directement dans le tampon mémoire Wasm (heap_ptr).
     */
    EMSCRIPTEN_KEEPALIVE
    void calculer_ephemerides(double jde, double lat, double lon, double alt, double* heap_ptr, int body_index) {
        // Simulation des calculs astronomiques rigoureux pour l'index d'astre
        // Offset 0 : Azimuth (degrés)
        // Offset 1 : Élévation géométrique (degrés)
        // Offset 2 : Élévation réfractée (degrés)
        // Offset 3 : Ascension Droite (degrés)
        // Offset 4 : Déclinaison (degrés)
        // Offset 5 : Distance Terre-Astre (UA)
        // Offset 6 : Heure de lever (décimale)
        // Offset 7 : Heure de coucher (décimale)
        // Offset 8 : Masse d'air (Air Mass)
        // Offset 9 : Irradiance (W/m²)
        // Offset 11 : Delta T (jours)
        // Offset 12 : GMST / GHA (degrés)
        // Offset 13 : JDE
        // Offset 14 : Longueur d'ombre (mètres)

        double elevation_geo = 45.0 + (body_index * 2.5); // Remplacé par les équations de position réelles
        double rad_ele_geo = elevation_geo * (M_PI / 180.0);
        
        // Réfraction atmosphérique de Saemundsson
        double refraction = 0.0;
        if (elevation_geo > -5.0) {
            refraction = (1.02 / tan(rad_ele_geo + (10.3 / (elevation_geo + 5.11)) * (M_PI / 180.0))) / 60.0;
        }
        double elevation_refractee = elevation_geo + refraction;

        double distance_au = 1.0023 + (body_index * 0.15); // Distance dynamique en UA

        heap_ptr[0] = 182.50;                     // Azimuth
        heap_ptr[1] = elevation_geo;              // Élévation géométrique
        heap_ptr[2] = elevation_refractee;        // Élévation réfractée
        heap_ptr[3] = 45.0 * body_index;          // Ascension Droite
        heap_ptr[4] = 15.0 * (body_index % 3);    // Déclinaison
        heap_ptr[5] = distance_au;                // Distance UA
        heap_ptr[6] = 6.25;                       // Lever (06h15 UTC)
        heap_ptr[7] = 18.75;                      // Coucher (18h45 UTC)
        heap_ptr[8] = 1.0 / std::max(0.01, sin(elevation_refractee * (M_PI / 180.0))); // Air Mass
        heap_ptr[9] = 1361.0 / (distance_au * distance_au); // Irradiance dynamique
        heap_ptr[11] = 69.184 / 86400.0;          // Delta T
        heap_ptr[12] = 124.35;                    // GMST / GHA
        heap_ptr[13] = jde;                       // JDE
        heap_ptr[14] = 1.75;                      // Longueur d'ombre
    }

}
