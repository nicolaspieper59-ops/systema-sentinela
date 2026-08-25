/**
 * Évalue un polynôme de Chebyshev via l'algorithme de Clenshaw.
 * 
 * @param {number} tJulian - Le temps courant en Jour Julien (JD).
 * @param {number} tStart - Le début de l'intervalle du tronçon (JD).
 * @param {number} tEnd - La fin de l'intervalle du tronçon (JD).
 * @param {Array<number>} coeffs - Tableau des coefficients de Chebyshev [C0, C1, ..., CN].
 * @returns {number} La valeur évaluée (position en km ou UA).
 */
function evaluerChebyshevClenshaw(tJulian, tStart, tEnd, coeffs) {
    const N = coeffs.length;
    if (N === 0) return 0;

    // 1. Normalisation du temps t dans l'intervalle [-1, 1]
    const tau = (2.0 * tJulian - (tStart + tEnd)) / (tEnd - tStart);

    // 2. Traitement des cas limites d'extrapolation
    const tauBorne = Math.max(-1.0, Math.min(1.0, tau));

    // 3. Récurrence inverse de Clenshaw
    const u = 2.0 * tauBorne;
    let b2 = 0.0;
    let b1 = 0.0;
    let b0 = 0.0;

    for (let i = N - 1; i >= 1; i--) {
        b0 = coeffs[i] + u * b1 - b2;
        b2 = b1;
        b1 = b0;
    }

    // 4. Calcul du résultat final pour T0(tau) et T1(tau)
    return coeffs[0] + tauBorne * b1 - b2;
}

/**
 * Évalue les coordonnées 3D (X, Y, Z) d'un corps céleste à partir d'un tronçon de coefficients.
 * 
 * @param {number} tJulian - Temps courant (JD).
 * @param {Object} tronon - Structure contenant { tStart, tEnd, coeffsX, coeffsY, coeffsZ }.
 * @returns {{x: number, y: number, z: number}} Coordonnées cartésiennes.
 */
function evaluerVecteurPosition3D(tJulian, tronon) {
    return {
        x: evaluerChebyshevClenshaw(tJulian, tronon.tStart, tronon.tEnd, tronon.coeffsX),
        y: evaluerChebyshevClenshaw(tJulian, tronon.tStart, tronon.tEnd, tronon.coeffsY),
        z: evaluerChebyshevClenshaw(tJulian, tronon.tStart, tronon.tEnd, tronon.coeffsZ)
    };
        }
