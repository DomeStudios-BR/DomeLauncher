use crate::launcher::{LauncherState, MinecraftAccount};
use tauri::State;

#[tauri::command]
pub fn check_auth_status(state: State<LauncherState>) -> Option<MinecraftAccount> {
    if let Ok(lock) = state.account.lock() {
        lock.clone()
    } else {
        None
    }
}

#[tauri::command]
pub fn logout(state: State<LauncherState>) -> Result<(), String> {
    state.clear_account()
}

#[tauri::command]
pub fn esquecer_contas_e_reiniciar_onboarding(state: State<LauncherState>) -> Result<(), String> {
    state.clear_all_accounts()?;
    crate::launcher::salvar_sessao_social_local(None)?;
    Ok(())
}

#[tauri::command]
pub fn list_minecraft_accounts(state: State<LauncherState>) -> Vec<MinecraftAccount> {
    state.list_accounts()
}

#[tauri::command]
pub fn switch_minecraft_account(
    state: State<LauncherState>,
    uuid: String,
) -> Result<MinecraftAccount, String> {
    state.set_active_account(uuid.trim())
}

#[tauri::command]
pub fn remove_minecraft_account(state: State<LauncherState>, uuid: String) -> Result<(), String> {
    state.remove_account(uuid.trim())
}

pub async fn refresh_token_interno(state: &LauncherState) -> Result<MinecraftAccount, String> {
    crate::auth_sisu::refresh_token_sisu_interno(state).await
}

/// Renova o token de acesso usando o refresh_token salvo
#[tauri::command]
pub async fn refresh_token(state: State<'_, LauncherState>) -> Result<MinecraftAccount, String> {
    refresh_token_interno(&state).await
}
