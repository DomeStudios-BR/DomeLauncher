use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

pub(crate) struct CanalProgresso(pub Option<Channel<ProgressoOperacao>>);

impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for CanalProgresso {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        let webview = command.message.webview();
        let id: Option<tauri::ipc::JavaScriptChannelId> = Deserialize::deserialize(command)
            .map_err(|erro| tauri::ipc::InvokeError::from(erro.to_string()))?;
        Ok(Self(id.map(|id| id.channel_on(webview))))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressoOperacao {
    pub porcentagem: u8,
    pub etapa: String,
}

#[derive(Clone, Default)]
pub(crate) struct Acompanhamento {
    canal: Option<Channel<ProgressoOperacao>>,
    inicio: u8,
    fim: u8,
    ultimo: Arc<Mutex<(u8, String)>>,
}

impl Acompanhamento {
    pub fn novo(canal: Option<Channel<ProgressoOperacao>>) -> Self {
        Self {
            canal,
            fim: 100,
            ..Self::default()
        }
    }

    pub fn faixa(&self, inicio: u8, fim: u8) -> Self {
        let intervalo = u16::from(self.fim.saturating_sub(self.inicio));
        let converter =
            |valor: u8| self.inicio + (intervalo * u16::from(valor.min(100)) / 100) as u8;
        Self {
            inicio: converter(inicio),
            fim: converter(fim),
            ..self.clone()
        }
    }

    pub fn informar(&self, etapa: &str, atual: u64, total: u64) {
        let Some(canal) = &self.canal else {
            return;
        };
        let fracao = if total == 0 {
            0.0
        } else {
            (atual as f64 / total as f64).clamp(0.0, 1.0)
        };
        let porcentagem =
            self.inicio + (f64::from(self.fim.saturating_sub(self.inicio)) * fracao) as u8;
        let Ok(mut ultimo) = self.ultimo.lock() else {
            return;
        };
        if porcentagem < ultimo.0 || (porcentagem == ultimo.0 && ultimo.1 == etapa) {
            return;
        }
        *ultimo = (porcentagem, etapa.into());
        let _ = canal.send(ProgressoOperacao {
            porcentagem,
            etapa: etapa.into(),
        });
    }

    pub fn concluir(&self, etapa: &str) {
        self.informar(etapa, 1, 1);
    }
}

pub(crate) async fn ler_download(
    resposta: reqwest::Response,
    acompanhamento: &Acompanhamento,
    etapa: &str,
) -> Result<Vec<u8>, String> {
    use futures::StreamExt;
    let resposta = resposta
        .error_for_status()
        .map_err(|e| e.without_url().to_string())?;
    let total = resposta.content_length().unwrap_or(0);
    let mut partes = resposta.bytes_stream();
    let mut bytes = Vec::new();
    acompanhamento.informar(etapa, 0, total);
    while let Some(parte) = partes.next().await {
        let parte = parte.map_err(|e| e.without_url().to_string())?;
        bytes.extend_from_slice(&parte);
        acompanhamento.informar(etapa, bytes.len() as u64, total);
    }
    acompanhamento.concluir(etapa);
    Ok(bytes)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn mantem_progresso_crescente_e_reserva_cem_para_conclusao() {
        let mensagens = Arc::new(Mutex::new(Vec::<u8>::new()));
        let recebidas = mensagens.clone();
        let canal = Channel::new(move |corpo| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = corpo {
                let dados: serde_json::Value = serde_json::from_str(&json).unwrap();
                recebidas
                    .lock()
                    .unwrap()
                    .push(dados["porcentagem"].as_u64().unwrap() as u8);
            }
            Ok(())
        });
        let progresso = Acompanhamento::novo(Some(canal));
        progresso.informar("Preparando", 0, 1);
        let download = progresso.faixa(10, 90);
        download.informar("Baixando", 50, 100);
        download.informar("Resposta atrasada", 10, 100);
        download.concluir("Download recebido");
        assert_eq!(*mensagens.lock().unwrap(), [0, 50, 90]);
        progresso.concluir("Instalação concluída");
        assert_eq!(*mensagens.lock().unwrap(), [0, 50, 90, 100]);
    }
}
