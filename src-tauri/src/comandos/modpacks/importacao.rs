use std::fs::File;
use std::path::Path;

use tauri::State;
use zip::ZipArchive;

use super::requisitos::{self, RequisitosModpack};
use crate::aplicacao::importacao_exportacao::criar_instancia_base_importada;
use crate::comandos::progresso_operacao::{Acompanhamento, CanalProgresso};
use crate::comandos::social_launcher::{pacotes_sociais, vinculos_sociais};
use crate::launcher::LauncherState;

fn ler_zip_curseforge<R: std::io::Read + std::io::Seek>(
    arquivo: &mut ZipArchive<R>,
) -> Result<(String, RequisitosModpack), String> {
    if arquivo.index_for_name("modrinth.index.json").is_some() {
        return Err("Selecione um ZIP de modpack do CurseForge.".into());
    }
    let mut entrada = arquivo
        .by_name("manifest.json")
        .map_err(|_| "O ZIP do CurseForge precisa conter manifest.json na raiz.")?;
    let manifesto = requisitos::ler_manifesto(&mut entrada)?;
    if manifesto["manifestType"].as_str() != Some("minecraftModpack")
        || manifesto["manifestVersion"].as_u64() != Some(1)
    {
        return Err("O formato do manifesto CurseForge não é suportado.".into());
    }
    let nome = manifesto["name"]
        .as_str()
        .map(str::trim)
        .filter(|nome| !nome.is_empty())
        .ok_or("O manifesto CurseForge não informa o nome do modpack.")?;
    let arquivos = manifesto["files"]
        .as_array()
        .ok_or("O manifesto CurseForge não informa a lista de arquivos.")?;
    if arquivos.iter().any(|arquivo| {
        !matches!(arquivo["projectID"].as_u64(), Some(1..))
            || !matches!(arquivo["fileID"].as_u64(), Some(1..))
    }) {
        return Err("O manifesto CurseForge contém uma referência de arquivo inválida.".into());
    }
    let requisitos = requisitos::requisitos_curseforge(&manifesto)?;
    if let Some(versao) = &requisitos.versao_loader {
        if !versao
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'))
            || matches!(versao.as_str(), "." | "..")
        {
            return Err("A versão do loader no manifesto CurseForge é inválida.".into());
        }
    }
    Ok((nome.into(), requisitos))
}

/// Importe um arquivo de instância Dome ou um modpack CurseForge pela biblioteca.
#[tauri::command]
pub(crate) async fn importar_arquivo_biblioteca(
    state: State<'_, LauncherState>,
    caminho_arquivo: String,
    progresso: CanalProgresso,
) -> Result<String, String> {
    let acompanhamento = Acompanhamento::novo(progresso.0);
    acompanhamento.informar("Lendo arquivo da instância", 0, 1);
    let caminho = caminho_arquivo.clone();
    let pacote = tauri::async_runtime::spawn_blocking(move || {
        let caminho = Path::new(&caminho);
        if !caminho.is_file() {
            return Err("Selecione um arquivo .dome ou .zip.".into());
        }
        let arquivo = File::open(caminho).map_err(|erro| format!("Erro ao abrir o ZIP: {erro}"))?;
        let mut arquivo =
            ZipArchive::new(arquivo).map_err(|erro| format!("ZIP inválido: {erro}"))?;
        if arquivo.index_for_name("dome_manifest.json").is_some()
            || arquivo.index_for_name("instance.json").is_some()
        {
            return Ok(None);
        }
        let (nome, requisitos) = ler_zip_curseforge(&mut arquivo)?;
        Ok::<_, String>(Some((arquivo, nome, requisitos)))
    })
    .await
    .map_err(|erro| erro.to_string())??;
    let Some((arquivo, nome, requisitos)) = pacote else {
        acompanhamento.informar("Importando instância Dome", 0, 1);
        let resultado = crate::aplicacao::importacao_exportacao::importar_instancia_em_estado(
            caminho_arquivo,
            &state,
        )
        .await?;
        return resultado.instancia_id.ok_or(resultado.mensagem);
    };

    let raiz = state.caminho_instancias()?;
    let pasta = raiz.join(format!(".dome-preparacao-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&pasta).map_err(|erro| erro.to_string())?;
    let _limpeza = pacotes_sociais::PastaTemporaria::nova(&raiz, &pasta)?;
    let estado_preparacao = LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: std::sync::Arc::new(std::sync::Mutex::new(pasta)),
    };
    acompanhamento
        .faixa(5, 45)
        .informar("Preparando Minecraft e loader", 0, 1);
    let instancia = criar_instancia_base_importada(
        &estado_preparacao,
        &nome,
        &requisitos.versao_minecraft,
        Some(&requisitos.loader),
        requisitos.versao_loader.as_deref(),
        None,
        true,
    )
    .await?;
    super::instalar_conteudo_zip(
        instancia.path.clone(),
        arquivo,
        super::cliente_modpack()?,
        true,
        &acompanhamento.faixa(45, 95),
    )
    .await?;
    let instalada = vinculos_sociais::publicar_local(&state, instancia, None)?;
    acompanhamento.concluir("Modpack CurseForge importado");
    Ok(instalada.id)
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;
    use std::io::{Cursor, Write};

    #[test]
    fn le_manifesto_do_ultimachance_e_rejeita_referencia_incompleta() {
        let mut manifesto = json!({
            "manifestType": "minecraftModpack",
            "manifestVersion": 1,
            "name": "UltimaChance",
            "minecraft": { "version": "1.18.2", "modLoaders": [
                { "id": "forge-40.2.21", "primary": true }
            ] },
            "files": [{ "projectID": 1, "fileID": 2, "required": true }]
        });
        let abrir = |manifesto: &serde_json::Value| {
            let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(manifesto.to_string().as_bytes()).unwrap();
            ZipArchive::new(zip.finish().unwrap()).unwrap()
        };
        let (nome, requisitos) = ler_zip_curseforge(&mut abrir(&manifesto)).unwrap();
        assert_eq!(nome, "UltimaChance");
        assert_eq!(requisitos.versao_minecraft, "1.18.2");
        assert_eq!(requisitos.versao_loader.as_deref(), Some("40.2.21"));
        manifesto["files"] = json!([{ "projectID": 1 }]);
        assert!(ler_zip_curseforge(&mut abrir(&manifesto)).is_err());
    }
}
