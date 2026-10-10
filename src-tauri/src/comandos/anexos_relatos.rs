use super::relatos_problemas::{carregar_sessao, obter_token};
use super::{criar_cliente_http_launcher, extrair_mensagem_erro_launcher, modpacks_dome};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AnexoRelato {
    pub id: String,
    pub tipo: String,
}

#[derive(Deserialize, Serialize)]
pub struct AnexoPublicado {
    id: String,
    tipo: String,
    url: String,
}

pub(super) fn validar_anexo(anexo: &AnexoRelato) -> Result<(), String> {
    if uuid::Uuid::parse_str(&anexo.id).is_err()
        || !matches!(
            anexo.tipo.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "video/mp4" | "video/webm"
        )
    {
        return Err("Anexo do relato inválido.".into());
    }
    Ok(())
}

async fn token_anexo(base: &str, perfil_id: &str) -> Result<String, String> {
    let sessao = carregar_sessao()?;
    if sessao["perfil"]["perfilId"].as_str() != Some(perfil_id) {
        return Err("A conta foi alterada. Abra o relato novamente.".into());
    }
    obter_token(base, &sessao).await
}

#[tauri::command]
pub async fn enviar_anexo_relato(
    api_base_url: String,
    perfil_id: String,
    envio_id: String,
    anexo_id: String,
    caminho_arquivo: String,
) -> Result<AnexoPublicado, String> {
    if uuid::Uuid::parse_str(&envio_id).is_err() || uuid::Uuid::parse_str(&anexo_id).is_err() {
        return Err("Identificador do anexo inválido.".into());
    }
    let base = modpacks_dome::normalizar_base_modpacks(&api_base_url)?;
    let token = token_anexo(&base, &perfil_id).await?;
    let caminho = std::path::Path::new(&caminho_arquivo);
    let extensao = caminho
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let limite = match extensao.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" => 16 * 1024 * 1024,
        "mp4" | "webm" => 64 * 1024 * 1024,
        _ => return Err("Selecione uma imagem PNG, JPG, WebP, GIF ou vídeo MP4/WebM.".into()),
    };
    let arquivo = tokio::fs::File::open(caminho)
        .await
        .map_err(|_| "Não foi possível abrir o anexo.")?;
    let tamanho = arquivo
        .metadata()
        .await
        .map_err(|_| "Não foi possível ler o tamanho do anexo.")?
        .len();
    if tamanho == 0 || tamanho > limite {
        return Err("Imagens podem ter até 16 MiB e vídeos até 64 MiB.".into());
    }
    let mut dados = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(
        &mut tokio::io::AsyncReadExt::take(arquivo, limite + 1),
        &mut dados,
    )
    .await
    .map_err(|_| "Não foi possível ler o anexo.")?;
    if dados.len() as u64 > limite {
        return Err("O anexo excede o tamanho permitido.".into());
    }
    if carregar_sessao()?["perfil"]["perfilId"].as_str() != Some(perfil_id.as_str()) {
        return Err("A conta foi alterada durante o envio do anexo.".into());
    }
    let resposta = criar_cliente_http_launcher()?
        .post(format!(
            "{base}/api/launcher/relatos/anexos/{envio_id}/{anexo_id}"
        ))
        .timeout(std::time::Duration::from_secs(180))
        .bearer_auth(token)
        .header("Content-Type", "application/octet-stream")
        .body(dados)
        .send()
        .await
        .map_err(|_| "Não foi possível enviar o anexo.")?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao enviar o anexo.").await);
    }
    let anexo: AnexoPublicado = resposta
        .json()
        .await
        .map_err(|_| "Resposta inválida do serviço de anexos.")?;
    validar_anexo(&AnexoRelato {
        id: anexo.id.clone(),
        tipo: anexo.tipo.clone(),
    })?;
    let extensao = match anexo.tipo.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => return Err("Tipo de anexo inesperado.".into()),
    };
    let esperada =
        format!("{base}/api/launcher/relatos/anexos/{perfil_id}/{envio_id}/{anexo_id}.{extensao}");
    if anexo.id != anexo_id || anexo.url != esperada {
        return Err("O serviço retornou um anexo inesperado.".into());
    }
    Ok(anexo)
}

#[tauri::command]
pub async fn excluir_anexo_relato(
    api_base_url: String,
    perfil_id: String,
    envio_id: String,
    anexo: AnexoRelato,
) -> Result<(), String> {
    validar_anexo(&anexo)?;
    if uuid::Uuid::parse_str(&envio_id).is_err() {
        return Err("Identificador do envio inválido.".into());
    }
    let base = modpacks_dome::normalizar_base_modpacks(&api_base_url)?;
    let token = token_anexo(&base, &perfil_id).await?;
    let tipo = anexo.tipo.replace('/', "_");
    let resposta = criar_cliente_http_launcher()?
        .delete(format!(
            "{base}/api/launcher/relatos/anexos/{envio_id}/{}/{tipo}",
            anexo.id
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Não foi possível remover o anexo.")?;
    if !resposta.status().is_success() {
        return Err("Não foi possível remover o anexo.".into());
    }
    Ok(())
}
