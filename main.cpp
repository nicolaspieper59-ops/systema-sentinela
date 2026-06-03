#include <fstream>
#include <iostream>
#include <cmath>
#include <chrono>
#include <thread>
#include <string>
#include <sstream>
#include <vector>
#include <iomanip>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <signal.h>
#include <sys/time.h>

const double PI = 3.14159265358979323846;

struct HorizonCoords {
    std::string nom;
    double azimut;
    double altitude;
    double ra_deg;   
    double dec_deg;  
    std::string symbole;
};

struct DonneesMeteo {
    double pression_hpa; 
    double temperature_c;   
};

struct ÉlémentsKepler {
    std::string nom;
    std::string symbole;
    double N0, N_cy;    // Longitude du nœud ascendant (degré, dérive par siècle)
    double i0, i_cy;    // Inclinaison sur l'écliptique
    double w0, w_cy;    // Argument du périhélie
    double a0, a_cy;    // Demi-grand axe (UA)
    double e0, e_cy;    // Excentricité
    double M0, M_cy;    // Anomalie moyenne
};

// Éphémérides semi-analytiques standard de haute précision (références J2000 / JPL)
const std::vector<ÉlémentsKepler> SYSTEME_SOLAIRE = {
    // NOM, SYMBOLE, N0, N_cy, i0, i_cy, w0, w_cy, a0, a_cy, e0, e_cy, M0, M_cy
    {"SOLEIL",  "☀️", 0.0, 0.0, 0.0, 0.0, 102.93768193, 0.32327364, 1.00000011, 0.0, 0.01671022, -0.00003804, 357.52910918, 35999.05029082},
    {"LUNE",    "🌙", 125.0445, -1934.136, 5.1454, 0.0, 318.15, 13.17639, 0.00257, 0.0, 0.054900, 0.0, 135.2708, 477198.868},
    {"MERCURE", "🪐", 48.33076593, -0.12534081, 7.00497902, -0.00594749, 29.1241, 0.0, 0.38709893, 0.0, 0.20563069, 0.00002040, 174.7948, 149472.6741},
    {"VENUS",   "⭐", 76.67984255, -0.27769418, 3.39467605, -0.00078890, 54.8910, 0.0, 0.72333199, 0.0, 0.00677323, -0.00004776, 50.1166, 58517.8153},
    {"MARS",    "🔴", 49.55953891, -0.29257343, 1.84969142, -0.00081313, 286.537, 0.0, 1.52366231, 0.0, 0.09341233, 0.00011902, 19.3881, 19140.3026},
    {"JUPITER", "🌌", 100.47390909, 0.20469106, 1.30439695, -0.00415660, 274.197, 0.0, 5.20336301, 0.0, 0.04839266, 0.00012880, 20.0202, 3034.7461},
    {"SATURNE", "🪐", 113.66242448, -0.28867794, 2.48599187, 0.00193609, 338.718, 0.0, 9.53707032, 0.0, 0.05415060, -0.00036762, 316.9670, 1222.1138}
};

double normaliserDegres(double angle) {
    angle = std::fmod(angle, 360.0);
    if (angle < 0.0) angle += 360.0;
    return angle;
}

double corrigerRefractionAtmospherique(double alt_brute, const DonneesMeteo& meteo) {
    if (alt_brute < -0.5) return alt_brute;
    double alt_deg = alt_brute < 0.0 ? 0.0 : alt_brute;
    double cotangente = 1.0 / std::tan((alt_deg + 7.31 / (alt_deg + 4.4)) * (PI / 180.0));
    return alt_brute + ((cotangente / 60.0) * (meteo.pression_hpa / 1013.25) * (288.15 / (273.15 + meteo.temperature_c)));
}

void interrogerCapteurGPS(double& lat, double& lon) {
    std::string cmd = "timeout 2 termux-location -p last -s network > gps.txt 2>/dev/null";
    if (std::system(cmd.c_str()) == 0) {
        std::ifstream fichier("gps.txt");
        std::string ligne;
        while (std::getline(fichier, ligne)) {
            size_t pLat = ligne.find("\"latitude\":");
            size_t pLon = ligne.find("\"longitude\":");
            if (pLat != std::string::npos) lat = std::stod(ligne.substr(pLat + 11));
            if (pLon != std::string::npos) lon = std::stod(ligne.substr(pLon + 12));
        }
    }
}

HorizonCoords calculerCoordonnees(const ÉlémentsKepler& p, double joursJ2000, double latDeg, double lonDeg, double heureUTC, const DonneesMeteo& meteo) {
    double T = joursJ2000 / 36525.0; // Siècles juliens depuis J2000.0

    // Évaluation des éléments orbitaux perturbés à l'instant T
    double a = p.a0 + p.a_cy * T;
    double e = p.e0 + p.e_cy * T;
    double i = normaliserDegres(p.i0 + p.i_cy * T) * PI / 180.0;
    double w = normaliserDegres(p.w0 + p.w_cy * T) * PI / 180.0;
    double M = normaliserDegres(p.M0 + p.M_cy * T) * PI / 180.0;
    double N = normaliserDegres(p.N0 + p.N_cy * T) * PI / 180.0;

    // Résolution numérique de l'Équation de Kepler (Newton-Raphson)
    double E = M;
    for (int iter = 0; iter < 10; ++iter) {
        double deltaE = (E - e * std::sin(E) - M) / (1.0 - e * std::cos(E));
        E -= deltaE;
        if (std::abs(deltaE) < 1e-6) break;
    }

    // Calcul des coordonnées héliocentriques dans le plan orbital
    double x_p = a * (std::cos(E) - e);
    double y_p = a * (std::sqrt(1.0 - e * e) * std::sin(E));

    // Transformation tridimensionnelle vers l'Écliptique
    double cos_N = std::cos(N), sin_N = std::sin(N);
    double cos_w = std::cos(w), sin_w = std::sin(w);
    double cos_i = std::cos(i), sin_i = std::sin(i);

    double x_ecl = x_p * (cos_N * cos_w - sin_N * sin_w * cos_i) - y_p * (cos_N * sin_w + sin_N * cos_w * cos_i);
    double y_ecl = x_p * (sin_N * cos_w + cos_N * sin_w * cos_i) - y_p * (sin_N * sin_w - cos_N * cos_w * cos_i);
    double z_ecl = x_p * (sin_w * sin_i) + y_p * (cos_w * sin_i);

    // Passage aux coordonnées Équatoriales (Obliquité de l'écliptique epsilon)
    double eps = (23.4392911 - 0.01300416 * T) * PI / 180.0;
    double x_eq = x_ecl;
    double y_eq = y_ecl * std::cos(eps) - z_ecl * std::sin(eps);
    double z_eq = y_ecl * std::sin(eps) + z_ecl * std::cos(eps);

    // Extraction de l'Ascension Droite (RA) et Déclinaison (DEC)
    double ra_rad = std::atan2(y_eq, x_eq);
    double dec_rad = std::asin(z_eq / std::sqrt(x_eq*x_eq + y_eq*y_eq + z_eq*z_eq));

    // CORRECTIF TEMPS SIDÉRAL CRITIQUE : Alignement astronomique universel J2000.0
    // 100.460618375 est la constante fondamentale de rotation de Greenwich à l'époque de référence
    double GMST = normaliserDegres(100.460618375 + 36000.770053608 * T + 0.000387933 * T * T + (heureUTC * 15.0));
    double LST_rad = normaliserDegres(GMST + lonDeg) * PI / 180.0;
    
    // Angle horaire local (HA)
    double angleHoraire_rad = LST_rad - ra_rad;
    double lat_rad = latDeg * PI / 180.0;

    // Calcul de l'Altitude Horizontale
    double sin_alt = std::sin(lat_rad) * std::sin(dec_rad) + std::cos(lat_rad) * std::cos(dec_rad) * std::cos(angleHoraire_rad);
    double altitude_brute = std::asin(sin_alt) * 180.0 / PI;
    double altitude_finale = corrigerRefractionAtmospherique(altitude_brute, meteo);

    // Calcul de l'Azimut (Orientation Boussole)
    double cos_az = (std::sin(dec_rad) - std::sin(lat_rad) * sin_alt) / (std::cos(lat_rad) * std::cos(altitude_brute * PI / 180.0));
    if (cos_az > 1.0) cos_az = 1.0; if (cos_az < -1.0) cos_az = -1.0;
    double azimut = std::acos(cos_az) * 180.0 / PI;
    if (std::sin(angleHoraire_rad) > 0) azimut = 360.0 - azimut;

    return { p.nom, azimut, altitude_finale, normaliserDegres(ra_rad * 180.0 / PI), dec_rad * 180.0 / PI, p.symbole };
}

int main() {
    signal(SIGPIPE, SIG_IGN);

    double latitude = 43.284565; // Marseille par défaut si pas de réseau
    double longitude = 5.358658;
    interrogerCapteurGPS(latitude, longitude);
    DonneesMeteo meteoLocale = { 1017.2, 19.5 };

    auto maintenant = std::chrono::system_clock::now();
    time_t temps_c = std::chrono::system_clock::to_time_t(maintenant);
    struct tm* utc = gmtime(&temps_c);
    
    // Calcul précis du jour julien partiel restant par rapport à l'époque J2000.0
    double baseJoursJ2000 = (utc->tm_year - 100) * 365.25 + utc->tm_yday - 1.5;

    // Matrice de calcul : Génération d'une journée complète (1440 points à pas de 1 min)
    std::string json_cache = "{\n";
    for (size_t i = 0; i < SYSTEME_SOLAIRE.size(); ++i) {
        const auto& p = SYSTEME_SOLAIRE[i];
        json_cache += "  \"" + p.nom + "\": [\n";
        for (int m = 0; m < 1440; ++m) {
            double heureUTC = m / 60.0;
            double joursJ2000 = baseJoursJ2000 + (heureUTC / 24.0);
            HorizonCoords astre = calculerCoordonnees(p, joursJ2000, latitude, longitude, heureUTC, meteoLocale);
            
            // Format d'injection léger pour le dashboard JavaScript
            json_cache += "    {\"az\": " + std::to_string(astre.azimut) + ", \"alt\": " + std::to_string(astre.altitude) + "}";
            if (m < 1439) json_cache += ",\n";
        }
        json_cache += "\n  ]";
        if (i < SYSTEME_SOLAIRE.size() - 1) json_cache += ",\n";
        else json_cache += "\n";
    }
    json_cache += "}";

    std::ofstream fichier_manifest("manifest.json");
    if (fichier_manifest.is_open()) { fichier_manifest << json_cache; fichier_manifest.close(); }

    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1; setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in address; address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY; address.sin_port = htons(8080);
    bind(server_fd, (struct sockaddr*)&address, sizeof(address)); listen(server_fd, 20);

    std::cout << "[ONLINE] Sentinela Engine v8.6 synchrone et actif sur le port 8080." << std::endl;

    while (true) {
        int new_socket = accept(server_fd, nullptr, nullptr);
        if (new_socket >= 0) {
            struct timeval tv; tv.tv_sec = 0; tv.tv_usec = 50000;
            setsockopt(new_socket, SOL_SOCKET, SO_RCVTIMEO, (const char*)&tv, sizeof(tv));

            char buffer[4096] = {0}; 
            int octets_lus = read(new_socket, buffer, 4095);
            if (octets_lus <= 0) { close(new_socket); continue; }

            std::string requete(buffer);

            if (requete.find("OPTIONS") != std::string::npos) {
                std::string reponse = "HTTP/1.1 204 No Content\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
                                      "Access-Control-Allow-Headers: *\r\n"
                                      "Connection: close\r\n\r\n";
                write(new_socket, reponse.c_str(), reponse.length());
            }
            else if (requete.find("GET /manifest.json") != std::string::npos) {
                std::string reponse = "HTTP/1.1 200 OK\r\n"
                                      "Content-Type: application/json; charset=UTF-8\r\n"
                                      "Content-Length: " + std::to_string(json_cache.length()) + "\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Connection: close\r\n\r\n" + json_cache;
                write(new_socket, reponse.c_str(), reponse.length());
            }
            else if (requete.find("GET / ") != std::string::npos || requete.find("GET /index.html") != std::string::npos) {
                auto m_maintenant = std::chrono::system_clock::now();
                time_t m_temps_c = std::chrono::system_clock::to_time_t(m_maintenant);
                struct tm* m_utc = gmtime(&m_temps_c);
                double m_heureUTC = m_utc->tm_hour + m_utc->tm_min / 60.0 + m_utc->tm_sec / 3600.0;
                double m_joursJ2000 = (m_utc->tm_year - 100) * 365.25 + m_utc->tm_yday + (m_heureUTC / 24.0) - 1.5;

                std::string cartes_html = "";
                for (const auto& p : SYSTEME_SOLAIRE) {
                    HorizonCoords astre = calculerCoordonnees(p, m_joursJ2000, latitude, longitude, m_heureUTC, meteoLocale);
                    std::string vue = (astre.altitude > 0) ? "<span style='color:#2ea043;font-weight:bold;'>🟢 VISIBLE</span>" : "<span style='color:#8b949e;'>🔴 HORIZON INF</span>";
                    cartes_html += "<div class='card'>"
                                   "<h3>" + astre.symbole + " " + astre.nom + " <span class='status'>" + vue + "</span></h3>"
                                   "<div class='data'>🧭 AZIMUT : " + std::to_string(astre.azimut) + "°</div>"
                                   "<div class='data'>📐 ALTITUDE : " + std::to_string(astre.altitude) + "°</div>"
                                   "</div>";
                }

                std::string html_body = "<html><head><title>SENTINELA v8.6</title>"
                    "<style>body{background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px;text-align:center;}"
                    "h1{color:#58a6ff;}.hud-bar{background:#161b22;border:1px solid #30363d;padding:12px 25px;display:inline-block;border-radius:30px;font-size:12px;margin-bottom:25px;}"
                    ".card{border:1px solid #30363d;background:#161b22;padding:15px;margin:12px auto;width:440px;border-radius:10px;text-align:left;}"
                    ".card h3{margin:0 0 12px 0;color:#58a6ff;display:flex;justify-content:space-between;}"
                    ".data{font-size:15px;margin:6px 0;}</style>"
                    "<script>setInterval(async()=>{try{let r=await fetch('/manifest.json');}catch(e){}},2000);</script></head>"
                    "<body><h1>SYSTEMA SENTINELA v8.6</h1>"
                    "<div class='hud-bar'>📍 LAT " + std::to_string(latitude) + " | LON " + std::to_string(longitude) + "</div><div id='content'>" + cartes_html + "</div></body></html>";

                std::string reponse = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n"
                                      "Content-Length: " + std::to_string(html_body.length()) + "\r\n"
                                      "Access-Control-Allow-Origin: *\r\n"
                                      "Connection: close\r\n\r\n" + html_body;
                write(new_socket, reponse.c_str(), reponse.length());
            }
            else {
                std::string reponse = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                write(new_socket, reponse.c_str(), reponse.length());
            }
            close(new_socket);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    close(server_fd); return 0;
}
