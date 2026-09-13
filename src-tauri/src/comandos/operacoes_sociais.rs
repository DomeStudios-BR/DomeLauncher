use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

fn operacoes() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static OPERACOES: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    OPERACOES.get_or_init(Default::default)
}

pub struct Operacao {
    pub token: CancellationToken,
    id: String,
}

impl Operacao {
    pub fn iniciar(id: &str) -> Result<Self, String> {
        let mut operacoes = operacoes().lock().map_err(|e| e.to_string())?;
        if operacoes.contains_key(id) {
            return Err("Transferência já está em andamento.".into());
        }
        let token = CancellationToken::new();
        operacoes.insert(id.into(), token.clone());
        Ok(Self {
            token,
            id: id.into(),
        })
    }
}

impl Drop for Operacao {
    fn drop(&mut self) {
        if let Ok(mut operacoes) = operacoes().lock() {
            operacoes.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn cancelar_transferencia_social_local(pedido_id: String) -> Result<(), String> {
    if let Some(token) = operacoes()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&pedido_id)
    {
        token.cancel();
    }
    Ok(())
}

pub struct Progresso {
    app: tauri::AppHandle,
    pedido_id: String,
    inicio: Instant,
    ultima_emissao: Instant,
    recebido: u64,
    total: Option<u64>,
    etapa: &'static str,
}

impl Progresso {
    pub fn novo(
        app: tauri::AppHandle,
        pedido_id: String,
        total: Option<u64>,
        etapa: &'static str,
    ) -> Self {
        Self {
            app,
            pedido_id,
            total,
            etapa,
            inicio: Instant::now(),
            ultima_emissao: Instant::now(),
            recebido: 0,
        }
    }
    pub fn avancar(&mut self, bytes: u64) {
        self.recebido += bytes;
        if self.ultima_emissao.elapsed() < Duration::from_millis(250)
            && self.total != Some(self.recebido)
        {
            return;
        }
        self.ultima_emissao = Instant::now();
        let _ = self.app.emit("social-transferencia-bytes", serde_json::json!({
            "pedidoId": self.pedido_id, "etapa": self.etapa, "bytes": self.recebido, "total": self.total,
            "bytesPorSegundo": self.recebido as f64 / self.inicio.elapsed().as_secs_f64().max(0.001)
        }));
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    #[test]
    fn cancela_e_libera_pedido_para_nova_tentativa() {
        let id = uuid::Uuid::new_v4().to_string();
        let operacao = Operacao::iniciar(&id).unwrap();
        assert!(Operacao::iniciar(&id).is_err());
        cancelar_transferencia_social_local(id.clone()).unwrap();
        assert!(operacao.token.is_cancelled());
        drop(operacao);
        let nova = Operacao::iniciar(&id).unwrap();
        assert!(!nova.token.is_cancelled());
    }
}
