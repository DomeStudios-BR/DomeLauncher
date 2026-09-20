export const VERSAO_ONBOARDING = 1;
export const CHAVE_ONBOARDING = 'dome:onboarding:versao-concluida';
export const CHAVE_FORCAR_ONBOARDING = 'dome:onboarding:forcar';
export const EVENTO_REEXIBIR_ONBOARDING = 'dome:reexibir-onboarding';

export function onboardingConcluido(): boolean {
    return Number(localStorage.getItem(CHAVE_ONBOARDING)) >= VERSAO_ONBOARDING;
}

export function concluirOnboarding(): void {
    localStorage.setItem(CHAVE_ONBOARDING, String(VERSAO_ONBOARDING));
    localStorage.removeItem(CHAVE_FORCAR_ONBOARDING);
}

export function reiniciarOnboarding(): void {
    localStorage.removeItem(CHAVE_ONBOARDING);
    localStorage.setItem(CHAVE_FORCAR_ONBOARDING, '1');
    window.dispatchEvent(new Event(EVENTO_REEXIBIR_ONBOARDING));
}

export function onboardingForcado(): boolean {
    return localStorage.getItem(CHAVE_FORCAR_ONBOARDING) === '1';
}
