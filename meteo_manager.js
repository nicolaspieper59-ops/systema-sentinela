/**
 * SYSTEMA SENTINELA — GESTIONNAIRE MÉTÉO STRICT (SANS FALLBACK AVEUGLE)
 */
class MeteoBaroManager {
    constructor() {
        this.currentData = null;
        this.lastCalibration = JSON.parse(localStorage.getItem('sentinela_meteo_calib')) || null;
        this.barometer = null;
        this.latestRawBaroHpa = null;
        this.initialiserCapteurBarometre();
    }

    initialiserCapteurBarometre() {
        if ('PressureSensor' in window) {
            try {
                this.barometer = new PressureSensor({ frequency: 1 });
                this.barometer.addEventListener('reading', () => {
                    this.latestRawBaroHpa = this.barometer.pressure;
                });
                this.barometer.start();
            } catch (err) {
                console.warn("[Météo] Capteur barométrique matériel non disponible :", err);
            }
        }
    }

    async acquerirDonneesApi(lat, lon) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,surface_pressure`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Échec de la requête HTTP Météo (${res.status})`);

            const data = await res.json();
            const tempApi = data.current.temperature_2m;
            const presApi = data.current.surface_pressure;

            this.currentData = { tempC: tempApi, presHpa: presApi, source: 'API_LIVE' };

            if (this.latestRawBaroHpa) {
                this.lastCalibration = {
                    timestamp: Date.now(),
                    pApi: presApi,
                    pBaro: this.latestRawBaroHpa,
                    tApi: tempApi
                };
                localStorage.setItem('sentinela_meteo_calib', JSON.stringify(this.lastCalibration));
            }

            return this.currentData;
        } catch (err) {
            console.warn("[Météo] API inaccessible, tentative de calcul différentiel hors-ligne strict...");
            return this.calculerStrictHorsLigne();
        }
    }

    calculerStrictHorsLigne() {
        if (!this.lastCalibration || !this.latestRawBaroHpa) {
            throw new Error("Erreur critique météo : Aucune connexion réseau et absence de calibration barométrique locale valide. Impossible de fournir des données physiques exactes.");
        }

        const { pApi, pBaro, tApi } = this.lastCalibration;
        const pCurrentBaro = this.latestRawBaroHpa;

        const ratioDiff = (pCurrentBaro - pBaro) / pBaro;
        const pEst = pApi * Math.exp(ratioDiff);

        const tKelvinApi = tApi + 273.15;
        const tKelvinEst = tKelvinApi * Math.pow(pEst / pApi, 0.286);
        const tEst = tKelvinEst - 273.15;

        this.currentData = {
            tempC: parseFloat(tEst.toFixed(2)),
            presHpa: parseFloat(pEst.toFixed(2)),
            source: 'OFFLINE_DIFFERENTIAL_STRICT'
        };

        return this.currentData;
    }
}

export const meteoManager = new MeteoBaroManager();
