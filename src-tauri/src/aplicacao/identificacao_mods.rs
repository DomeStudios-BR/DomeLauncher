use super::*;
use futures::{stream, StreamExt};
use serde_json::Value;
use sha2::{Digest, Sha512};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[path = "cache_identificacao_mods.rs"]
mod cache;
pub(super) use cache::restaurar_identificacoes;

const TAMANHO_LOTE: usize = 100;
const LOTES_SIMULTANEOS: usize = 4;
static VAGAS_CONSULTA: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(LOTES_SIMULTANEOS);

#[cfg(test)]
#[path = "testes_identificacao_mods.rs"]
mod testes;

#[derive(Clone)]
struct AssinaturaMod {
    nome: String,
    sha512: String,
    fingerprint: Option<u32>,
    caminho: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModIdentificado {
    file_name: String,
    project_id: Option<String>,
    source: Option<String>,
    version: Option<String>,
    version_id: Option<String>,
}

#[derive(Serialize, Default)]
pub(crate) struct ResultadoIdentificacao {
    itens: Vec<ModIdentificado>,
    falhas: Vec<String>,
}

#[tauri::command]
pub(crate) async fn identificar_mods_instalados(
    instance_id: String,
    state: State<'_, LauncherState>,
) -> Result<ResultadoIdentificacao, String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let raiz = state.caminho_instancias()?;
    let caminho = validar_caminho_dentro_raiz(&raiz, &instancia.path)?;
    let cliente = reqwest::Client::builder()
        .user_agent("DomeLauncher/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|erro| format!("Falha ao preparar identificação: {erro}"))?;
    cache::identificar_com_cache(&cliente, &caminho, MODRINTH_API_BASE, CURSEFORGE_API_BASE).await
}

#[cfg(test)]
fn ler_assinaturas(instancia: &Path) -> Result<Vec<AssinaturaMod>, String> {
    Ok(cache::preparar(instancia, cache::CacheIdentificacao::default())?.assinaturas)
}

async fn consultar_json(requisicao: reqwest::RequestBuilder, fonte: &str) -> Result<Value, String> {
    let _vaga = VAGAS_CONSULTA
        .acquire()
        .await
        .map_err(|erro| erro.to_string())?;
    requisicao
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|erro| format!("Falha ao identificar mods no {fonte}: {erro}"))?
        .json()
        .await
        .map_err(|erro| format!("Resposta inválida do {fonte}: {erro}"))
}

fn correspondencia_modrinth(
    assinatura: &AssinaturaMod,
    resposta: &Value,
) -> Option<ModIdentificado> {
    let versao = resposta.get(&assinatura.sha512)?;
    let arquivos = versao["files"].as_array()?;
    if !arquivos
        .iter()
        .any(|arquivo| arquivo["hashes"]["sha512"].as_str() == Some(&assinatura.sha512))
    {
        return None;
    }
    Some(ModIdentificado {
        file_name: assinatura.nome.clone(),
        project_id: Some(versao["project_id"].as_str()?.to_string()),
        source: Some("modrinth".into()),
        version: versao["version_number"].as_str().map(str::to_string),
        version_id: Some(versao["id"].as_str()?.to_string()),
    })
}

fn correspondencia_curseforge(
    assinatura: &AssinaturaMod,
    resposta: &Value,
) -> Option<ModIdentificado> {
    let correspondencias = resposta["data"]["exactMatches"].as_array()?;
    let arquivo = correspondencias.iter().find_map(|item| {
        let arquivo = &item["file"];
        (arquivo["fileFingerprint"].as_u64() == assinatura.fingerprint.map(u64::from))
            .then_some(arquivo)
    })?;
    Some(ModIdentificado {
        file_name: assinatura.nome.clone(),
        project_id: Some(arquivo["modId"].as_u64()?.to_string()),
        source: Some("curseforge".into()),
        version: None,
        version_id: Some(arquivo["id"].as_u64()?.to_string()),
    })
}

async fn identificar_assinaturas(
    cliente: &reqwest::Client,
    assinaturas: &[AssinaturaMod],
    base_modrinth: &str,
    base_curseforge: &str,
) -> Result<ResultadoIdentificacao, String> {
    let mut consultas = Vec::new();
    for (indice, lote) in assinaturas.chunks(TAMANHO_LOTE).enumerate() {
        consultas.push(async move {
            (
                indice,
                identificar_lote(cliente, lote, base_modrinth, base_curseforge).await,
            )
        });
    }
    let lotes = stream::iter(consultas).buffer_unordered(LOTES_SIMULTANEOS);
    tokio::pin!(lotes);
    let mut parciais = Vec::new();
    while let Some(parcial) = lotes.next().await {
        parciais.push(parcial);
    }
    parciais.sort_by_key(|(indice, _)| *indice);
    let mut resultado = ResultadoIdentificacao::default();
    for (_, parcial) in parciais {
        resultado.itens.extend(parcial.itens);
        for erro in parcial.falhas {
            if !resultado.falhas.contains(&erro) {
                resultado.falhas.push(erro);
            }
        }
    }
    Ok(resultado)
}

async fn identificar_lote(
    cliente: &reqwest::Client,
    lote: &[AssinaturaMod],
    base_modrinth: &str,
    base_curseforge: &str,
) -> ResultadoIdentificacao {
    let mut resultado = ResultadoIdentificacao::default();
    {
        let modrinth = consultar_json(
            cliente
                .post(format!("{base_modrinth}/version_files"))
                .json(&serde_json::json!({
                    "hashes": lote.iter().map(|item| &item.sha512).collect::<Vec<_>>(),
                    "algorithm": "sha512"
                })),
            "Modrinth",
        )
        .await
        .and_then(|resposta| {
            resposta
                .is_object()
                .then_some(resposta)
                .ok_or("Resposta inválida do Modrinth.".into())
        });
        let mut identificados = HashMap::new();
        if let Ok(ref resposta) = modrinth {
            for assinatura in lote {
                if let Some(item) = correspondencia_modrinth(assinatura, resposta) {
                    identificados.insert(assinatura.nome.clone(), item);
                }
            }
        }
        let pendentes = lote
            .iter()
            .filter(|item| !identificados.contains_key(&item.nome))
            .cloned()
            .collect::<Vec<_>>();
        let pendentes = preparar_fingerprints(pendentes).await;
        let curseforge = if pendentes.as_ref().is_ok_and(Vec::is_empty) {
            Ok(serde_json::json!({"data": {"exactMatches": []}}))
        } else if let Ok(ref pendentes) = pendentes {
            match anexar_headers_curseforge(cliente.post(format!("{base_curseforge}/fingerprints")).json(
                &serde_json::json!({"fingerprints": pendentes.iter().filter_map(|item| item.fingerprint).collect::<Vec<_>>()}),
            )) {
                Ok(requisicao) => consultar_json(requisicao, "CurseForge").await.and_then(|resposta| {
                    resposta["data"]["exactMatches"].is_array().then_some(resposta)
                        .ok_or("Resposta inválida do CurseForge.".into())
                }),
                Err(erro) => Err(erro),
            }
        } else {
            Err(pendentes.as_ref().err().unwrap().clone())
        };
        if let Ok(ref resposta) = curseforge {
            for assinatura in pendentes.as_ref().unwrap() {
                if let Some(item) = correspondencia_curseforge(assinatura, resposta) {
                    identificados.insert(assinatura.nome.clone(), item);
                }
            }
        }
        for assinatura in lote {
            if let Some(item) = identificados.remove(&assinatura.nome) {
                resultado.itens.push(item);
            } else if modrinth.is_ok() && curseforge.is_ok() {
                resultado.itens.push(ModIdentificado {
                    file_name: assinatura.nome.clone(),
                    project_id: None,
                    source: None,
                    version: None,
                    version_id: None,
                });
            }
        }
        for erro in [modrinth.err(), curseforge.err()].into_iter().flatten() {
            if !resultado.falhas.contains(&erro) {
                resultado.falhas.push(erro);
            }
        }
    }
    resultado
}

async fn preparar_fingerprints(
    mut pendentes: Vec<AssinaturaMod>,
) -> Result<Vec<AssinaturaMod>, String> {
    if pendentes.iter().all(|item| item.fingerprint.is_some()) {
        return Ok(pendentes);
    }
    tauri::async_runtime::spawn_blocking(move || {
        for item in &mut pendentes {
            if item.fingerprint.is_some() {
                continue;
            }
            let caminho = item
                .caminho
                .as_ref()
                .ok_or("Mod sem caminho para identificação.")?;
            let bytes = std::fs::read(caminho)
                .map_err(|erro| format!("Erro ao ler {}: {erro}", item.nome))?;
            if format!("{:x}", Sha512::digest(&bytes)) != item.sha512 {
                return Err(format!(
                    "O arquivo {} mudou durante a identificação. Tente novamente.",
                    item.nome
                ));
            }
            item.fingerprint = Some(super::assinaturas_conteudo::fingerprint_bytes_curseforge(
                &bytes,
            ));
        }
        Ok(pendentes)
    })
    .await
    .map_err(|erro| format!("Falha ao calcular assinaturas: {erro}"))?
}
