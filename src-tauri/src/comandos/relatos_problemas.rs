use super::anexos_relatos::{validar_anexo, AnexoRelato};
use super::{
    criar_cliente_http_launcher, extrair_mensagem_erro_launcher, modpacks_dome,
    refresh_launcher_social_session,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbienteRelato {
    versao_launcher: String,
    sistema_operacional: String,
    arquitetura: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviaRelato {
    ambiente: AmbienteRelato,
    perfil_id: String,
    nome: String,
    handle: String,
    minecraft: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DadosRelato {
    envio_id: String,
    perfil_id: String,
    titulo: String,
    descricao: String,
    logs: Option<String>,
    #[serde(default)]
    anexos: Vec<AnexoRelato>,
}

#[derive(Serialize, Deserialize)]
pub struct IssueCriada {
    numero: u64,
    url: String,
}

pub(super) fn carregar_sessao() -> Result<Value, String> {
    let texto = crate::launcher::carregar_sessao_social_local()?
        .ok_or("Entre com a Microsoft para enviar um relato.")?;
    let sessao: Value = serde_json::from_str(&texto).map_err(|_| "Sessão Dome inválida.")?;
    if sessao["perfil"]["perfilId"].as_str().is_none() || sessao["accessToken"].as_str().is_none() {
        return Err("Entre novamente para enviar um relato.".into());
    }
    Ok(sessao)
}

fn obter_ambiente() -> AmbienteRelato {
    let nome = sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.into());
    let versao = sysinfo::System::os_version().unwrap_or_default();
    AmbienteRelato {
        versao_launcher: env!("CARGO_PKG_VERSION").into(),
        sistema_operacional: format!("{nome} {versao}")
            .trim()
            .chars()
            .take(120)
            .collect(),
        arquitetura: std::env::consts::ARCH.into(),
    }
}

#[tauri::command]
pub async fn preparar_relato_problema() -> Result<PreviaRelato, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let sessao = carregar_sessao()?;
        let perfil = &sessao["perfil"];
        let contas = perfil["contasMinecraftVinculadas"].as_array();
        let conta = contas.and_then(|contas| {
            contas
                .iter()
                .find(|conta| conta["uuid"] == perfil["contaMinecraftPrincipalUuid"])
                .or_else(|| contas.first())
        });
        Ok(PreviaRelato {
            ambiente: obter_ambiente(),
            perfil_id: perfil["perfilId"].as_str().unwrap_or_default().into(),
            nome: perfil["nomeSocial"].as_str().unwrap_or_default().into(),
            handle: perfil["handle"].as_str().unwrap_or_default().into(),
            minecraft: conta
                .and_then(|conta| conta["nome"].as_str())
                .unwrap_or("Não vinculado")
                .into(),
        })
    })
    .await
    .map_err(|_| "Não foi possível preparar o diagnóstico.".to_string())?
}

fn validar_dados(dados: &DadosRelato) -> Result<(), String> {
    if dados.anexos.len() > 4 {
        return Err("Inclua até quatro anexos por relato.".into());
    }
    for anexo in &dados.anexos {
        validar_anexo(anexo)?;
    }
    if uuid::Uuid::parse_str(&dados.envio_id).is_err() {
        return Err("Identificador do envio inválido.".into());
    }
    if !(5..=120).contains(&dados.titulo.trim().chars().count())
        || !(10..=10000).contains(&dados.descricao.trim().chars().count())
        || dados
            .logs
            .as_ref()
            .is_some_and(|logs| logs.chars().count() > 24000)
    {
        return Err("Confira o título, a descrição e o tamanho dos logs.".into());
    }
    Ok(())
}

pub(super) async fn obter_token(base: &str, sessao: &Value) -> Result<String, String> {
    let expirada = sessao["expiraEm"]
        .as_str()
        .and_then(|data| chrono::DateTime::parse_from_rfc3339(data).ok())
        .is_none_or(|data| data.timestamp() <= chrono::Utc::now().timestamp() + 30);
    if !expirada {
        return Ok(sessao["accessToken"].as_str().unwrap_or_default().into());
    }
    let refresh = sessao["refreshToken"]
        .as_str()
        .ok_or("Entre novamente para enviar o relato.")?;
    let renovada = refresh_launcher_social_session(base.into(), refresh.into()).await?;
    renovada["accessToken"]
        .as_str()
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .ok_or("Não foi possível renovar a sessão Dome.".into())
}

#[tauri::command]
pub async fn enviar_relato_problema(
    api_base_url: String,
    dados: DadosRelato,
) -> Result<IssueCriada, String> {
    validar_dados(&dados)?;
    let base = modpacks_dome::normalizar_base_modpacks(&api_base_url)?;
    let sessao = carregar_sessao()?;
    if sessao["perfil"]["perfilId"].as_str() != Some(dados.perfil_id.as_str()) {
        return Err("A conta foi alterada. Feche o modal e confira o relato novamente.".into());
    }
    let token = obter_token(&base, &sessao).await?;
    if carregar_sessao()?["perfil"]["perfilId"] != sessao["perfil"]["perfilId"] {
        return Err("A conta foi alterada durante o envio.".into());
    }
    let resposta = criar_cliente_http_launcher()?
        .post(format!("{base}/api/launcher/relatos"))
        .timeout(std::time::Duration::from_secs(25))
        .json(&json!({
            "envioId": dados.envio_id, "titulo": dados.titulo.trim(), "descricao": dados.descricao.trim(),
            "ambiente": obter_ambiente(), "logs": dados.logs, "anexos": dados.anexos,
        }))
        .bearer_auth(token)
        .send().await.map_err(|_| {
            "Não foi possível confirmar o envio. Confira as issues do repositório antes de criar outro relato.".to_string()
        })?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao enviar o relato.").await);
    }
    let issue: IssueCriada = resposta
        .json()
        .await
        .map_err(|_| "Resposta inválida do serviço de relatos.")?;
    if issue.numero == 0
        || issue.url
            != format!(
                "https://github.com/DomeStudios-BR/DomeLauncher/issues/{}",
                issue.numero,
            )
    {
        return Err("O serviço retornou um destino inesperado para a issue.".into());
    }
    Ok(issue)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejeita_relato_vazio_e_logs_excessivos() {
        let mut dados = DadosRelato {
            envio_id: uuid::Uuid::new_v4().to_string(),
            perfil_id: "perfil".into(),
            titulo: "Falha ao abrir".into(),
            descricao: "A janela não abre ao clicar.".into(),
            logs: None,
            anexos: Vec::new(),
        };
        assert!(validar_dados(&dados).is_ok());
        dados.descricao = "   ".into();
        assert!(validar_dados(&dados).is_err());
        dados.descricao = "A janela não abre ao clicar.".into();
        dados.logs = Some("a".repeat(24001));
        assert!(validar_dados(&dados).is_err());
    }
}
