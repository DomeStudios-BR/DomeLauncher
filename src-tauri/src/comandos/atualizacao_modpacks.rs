use crate::launcher::{Instance, LauncherState};
use std::sync::{Arc, Mutex};
use tauri::State;

use super::modpacks::{self, ModpackInfo};
use super::progresso_operacao::{Acompanhamento, CanalProgresso};
use super::projetos_conteudo::{baixar_pacote_com_progresso, ler_manifesto, versao_remota};
use super::social_launcher::{pacotes_sociais, vinculos_sociais};

fn ambiente_manifesto(
    fonte: &str,
    bytes: &[u8],
) -> Result<(String, Option<String>, Option<String>), String> {
    if fonte == "modrinth" {
        let manifesto = ler_manifesto(bytes, "modrinth.index.json")?;
        let dependencias = &manifesto["dependencies"];
        let minecraft = dependencias["minecraft"]
            .as_str()
            .ok_or("Índice sem versão do Minecraft.")?;
        for (chave, loader) in [
            ("fabric-loader", "fabric"),
            ("forge", "forge"),
            ("neoforge", "neoforge"),
        ] {
            if let Some(versao) = dependencias[chave].as_str() {
                return Ok((minecraft.into(), Some(loader.into()), Some(versao.into())));
            }
        }
        if dependencias["quilt-loader"].is_string() {
            return Err("Quilt ainda não é suportado.".into());
        }
        return Ok((minecraft.into(), None, None));
    }
    let manifesto = ler_manifesto(bytes, "manifest.json")?;
    let minecraft = manifesto["minecraft"]["version"]
        .as_str()
        .ok_or("Manifesto sem versão do Minecraft.")?;
    let loaders = manifesto["minecraft"]["modLoaders"]
        .as_array()
        .ok_or("Manifesto sem loader.")?;
    let loader = loaders
        .iter()
        .find(|l| l["primary"] == true)
        .or_else(|| loaders.first())
        .and_then(|l| l["id"].as_str())
        .ok_or("Loader não informado no manifesto.")?;
    for prefixo in ["neoforge-", "forge-", "fabric-"] {
        if let Some(versao) = loader.strip_prefix(prefixo).filter(|v| !v.is_empty()) {
            return Ok((
                minecraft.into(),
                Some(prefixo.trim_end_matches('-').into()),
                Some(versao.into()),
            ));
        }
    }
    Err(format!("Loader não suportado: {loader}"))
}

pub(crate) fn arquivos_gerenciados(
    instancia: &Instance,
) -> Result<Vec<pacotes_sociais::ArquivoSocial>, String> {
    pacotes_sociais::arquivos_modpack(instancia)
}

fn estado_preparacao(state: &LauncherState, pasta: std::path::PathBuf) -> LauncherState {
    LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: Arc::new(Mutex::new(pasta)),
    }
}

#[tauri::command]
pub(crate) async fn trocar_versao_modpack_publico(
    state: State<'_, LauncherState>,
    instance_id: String,
    projeto_id: String,
    versao_id: String,
    fonte: String,
    progresso: CanalProgresso,
) -> Result<(), String> {
    let acompanhamento = Acompanhamento::novo(progresso.0);
    acompanhamento.informar("Verificando modpack", 0, 1);
    if !["modrinth", "curseforge"].contains(&fonte.as_str()) {
        return Err("Fonte inválida.".into());
    }
    let antiga = super::instancia_sistema::obter_instancia_por_id(&state, &instance_id)?;
    let _reserva = crate::aplicacao::reserva_instancia::ReservaInstancia::nova(
        &state.caminho_instancias()?,
        &antiga.path,
    )?;
    if state.obter_pid_instancia(&instance_id).is_some() {
        return Err("Feche o jogo antes de trocar a versão.".into());
    }
    let info = modpacks::get_modpack_info(state.clone(), instance_id)
        .await?
        .ok_or("Esta instância não está vinculada a um modpack.")?;
    if info.project_id != projeto_id || info.source != fonte {
        return Err("Esta instância não pertence ao modpack escolhido.".into());
    }
    let versao = versao_remota(&fonte, &projeto_id, &versao_id).await?;
    let bytes =
        baixar_pacote_com_progresso(&fonte, &projeto_id, &versao, &acompanhamento.faixa(5, 25))
            .await?;
    let fonte_manifesto = fonte.clone();
    let (bytes, ambiente) = tauri::async_runtime::spawn_blocking(move || {
        let ambiente = ambiente_manifesto(&fonte_manifesto, &bytes)?;
        Ok::<_, String>((bytes, ambiente))
    })
    .await
    .map_err(|e| e.to_string())??;
    let raiz = state.caminho_instancias()?;
    let pasta = raiz.join(format!(".dome-preparacao-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&pasta).map_err(|e| e.to_string())?;
    let _limpeza = pacotes_sociais::PastaTemporaria::nova(&raiz, &pasta)?;
    let estado = estado_preparacao(&state, pasta);
    let preparada = crate::aplicacao::importacao_exportacao::criar_instancia_base_importada(
        &estado,
        "modpack",
        &ambiente.0,
        ambiente.1.as_deref(),
        ambiente.2.as_deref(),
        antiga.icon.as_deref(),
        true,
    )
    .await?;
    acompanhamento
        .faixa(25, 55)
        .concluir("Minecraft e loader preparados");
    modpacks::instalar_arquivos_em_pasta_com_progresso(
        preparada.path.clone(),
        String::new(),
        "pacote.zip".into(),
        Some(bytes),
        &acompanhamento.faixa(55, 95),
    )
    .await?;
    for pessoal in [
        "options.txt",
        "optionsof.txt",
        "optionsshaders.txt",
        "servers.dat",
    ] {
        let caminho = preparada.path.join(pessoal);
        if caminho.exists() {
            std::fs::remove_file(caminho).map_err(|e| e.to_string())?;
        }
    }
    let mut novo_info: ModpackInfo = info;
    novo_info.version_id = versao_id;
    novo_info.installed_version = versao[if fonte == "curseforge" {
        "displayName"
    } else {
        "version_number"
    }]
    .as_str()
    .ok_or("Versão sem nome.")?
    .into();
    let estado_final = estado_preparacao(&state, raiz);
    tauri::async_runtime::spawn_blocking(move || {
        let antigos = arquivos_gerenciados(&antiga)?;
        let novos = arquivos_gerenciados(&preparada)?;
        let anterior = vinculos_sociais::VinculoSocial {
            compartilhamento_id: projeto_id,
            api_base_url: fonte,
            versao: 1,
            arquivos: antigos,
            substituir_alteracoes_locais: true,
        };
        let novo = vinculos_sociais::VinculoSocial {
            arquivos: novos,
            ..anterior.clone()
        };
        modpacks::salvar_info_em_pasta(&preparada.path, novo_info)?;
        vinculos_sociais::publicar_modpack_publico_local(
            &estado_final,
            preparada,
            antiga,
            anterior,
            novo,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    acompanhamento.concluir("Versão trocada");
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::Value;
    use std::io::Write;

    fn pacote(nome: &str, manifesto: Value) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(nome, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(serde_json::to_string(&manifesto).unwrap().as_bytes())
            .unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn troca_usa_minecraft_e_loader_exatos_do_manifesto() {
        let bytes = pacote(
            "manifest.json",
            serde_json::json!({
                "minecraft": {"version": "1.20.1", "modLoaders": [{"id": "forge-47.4.10", "primary": true}]}
            }),
        );
        assert_eq!(
            ambiente_manifesto("curseforge", &bytes).unwrap(),
            (
                "1.20.1".into(),
                Some("forge".into()),
                Some("47.4.10".into())
            )
        );
        let bytes = pacote(
            "modrinth.index.json",
            serde_json::json!({
                "dependencies": {"minecraft": "1.21.1", "neoforge": "21.1.12"}
            }),
        );
        assert_eq!(
            ambiente_manifesto("modrinth", &bytes).unwrap(),
            (
                "1.21.1".into(),
                Some("neoforge".into()),
                Some("21.1.12".into())
            )
        );
    }

    fn instancia_teste(raiz: &std::path::Path, id: &str, versao: &str) -> Instance {
        let pasta = raiz.join(id);
        std::fs::create_dir_all(pasta.join("mods")).unwrap();
        let instancia: Instance = serde_json::from_value(serde_json::json!({
            "id": id, "name": "Minha aventura", "version": versao, "mcType": "fabric", "loaderType": "Fabric",
            "loaderVersion": "0.16.10",
            "path": pasta, "created": "2026-10-27", "memory": 8192,
        })).unwrap();
        std::fs::write(
            pasta.join("instance.json"),
            serde_json::to_vec(&instancia).unwrap(),
        )
        .unwrap();
        instancia
    }

    #[test]
    fn troca_remove_mods_antigos_e_adicionais_preserva_mundo_e_guarda_backup() {
        let raiz = std::env::temp_dir().join(format!("dome-troca-teste-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        let _limpeza =
            pacotes_sociais::PastaTemporaria::nova(raiz.parent().unwrap(), &raiz).unwrap();
        let state = LauncherState {
            account: Default::default(),
            accounts: Default::default(),
            processos_instancias: Default::default(),
            instances_path: Arc::new(Mutex::new(raiz.clone())),
        };
        let antiga = instancia_teste(&raiz, "original", "1.21.1");
        std::fs::write(antiga.path.join("mods/antigo.jar"), b"mod antigo").unwrap();
        std::fs::write(
            antiga.path.join("mods/adicional.jar.disabled"),
            b"adicional",
        )
        .unwrap();
        std::fs::create_dir(antiga.path.join("openloader")).unwrap();
        std::fs::write(antiga.path.join("openloader/antigo.json"), b"config antiga").unwrap();
        std::fs::write(
            antiga.path.join("modpack-arquivos.json"),
            b"[\"openloader/antigo.json\"]",
        )
        .unwrap();
        std::fs::write(antiga.path.join("options.txt"), b"opcoes pessoais").unwrap();
        std::fs::create_dir(antiga.path.join("saves")).unwrap();
        std::fs::write(antiga.path.join("saves/mundo.dat"), b"meu mundo").unwrap();
        let mut preparada = instancia_teste(&raiz.join(".preparacao"), "nova", "1.20.1");
        preparada.loader_type = Some("Forge".into());
        preparada.mc_type = "forge".into();
        preparada.loader_version = Some("1.20.1-47.4.10".into());
        std::fs::write(preparada.path.join("mods/novo.jar"), b"mod novo").unwrap();
        let anterior = vinculos_sociais::VinculoSocial {
            compartilhamento_id: "projeto".into(),
            api_base_url: "modrinth".into(),
            versao: 1,
            arquivos: arquivos_gerenciados(&antiga).unwrap(),
            substituir_alteracoes_locais: true,
        };
        let novo = vinculos_sociais::VinculoSocial {
            arquivos: arquivos_gerenciados(&preparada).unwrap(),
            ..anterior.clone()
        };
        let instalada = vinculos_sociais::publicar_modpack_publico_local(
            &state, preparada, antiga, anterior, novo,
        )
        .unwrap();
        assert_eq!(instalada.id, "original");
        assert_eq!(instalada.version, "1.20.1");
        assert_eq!(instalada.loader_type.as_deref(), Some("Forge"));
        assert_eq!(instalada.memory, Some(8192));
        assert!(!instalada.path.join("mods/antigo.jar").exists());
        assert!(!instalada.path.join("mods/adicional.jar.disabled").exists());
        assert!(!instalada.path.join("openloader/antigo.json").exists());
        assert_eq!(
            std::fs::read(instalada.path.join("mods/novo.jar")).unwrap(),
            b"mod novo"
        );
        assert_eq!(
            std::fs::read(instalada.path.join("options.txt")).unwrap(),
            b"opcoes pessoais"
        );
        assert_eq!(
            std::fs::read(instalada.path.join("saves/mundo.dat")).unwrap(),
            b"meu mundo"
        );
        let backup = std::fs::read_dir(raiz.join(".social-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            std::fs::read(backup.join("mods/antigo.jar")).unwrap(),
            b"mod antigo"
        );
        assert_eq!(
            std::fs::read(backup.join("mods/adicional.jar.disabled")).unwrap(),
            b"adicional"
        );
    }

    #[tokio::test]
    async fn falha_de_download_na_preparacao_preserva_instancia_original() {
        let raiz = std::env::temp_dir().join(format!("dome-falha-teste-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        let _limpeza =
            pacotes_sociais::PastaTemporaria::nova(raiz.parent().unwrap(), &raiz).unwrap();
        let antiga = instancia_teste(&raiz, "original", "1.21.1");
        std::fs::write(antiga.path.join("mods/antigo.jar"), b"original").unwrap();
        let preparada = instancia_teste(&raiz, "preparacao", "1.20.1");
        let bytes = pacote(
            "modrinth.index.json",
            serde_json::json!({"dependencies": {"minecraft": "1.20.1", "fabric-loader": "0.16.10"}, "files": [{
                "path": "mods/novo.jar", "downloads": ["url invalida"]
            }]}),
        );
        assert!(modpacks::instalar_arquivos_em_pasta(
            preparada.path,
            String::new(),
            "pacote.zip".into(),
            Some(bytes),
        )
        .await
        .is_err());
        assert_eq!(
            std::fs::read(antiga.path.join("mods/antigo.jar")).unwrap(),
            b"original"
        );
        assert!(!antiga.path.join("mods/novo.jar").exists());
    }

    #[tokio::test]
    async fn recusa_travessia_no_indice_antes_de_gravar_arquivo() {
        let raiz =
            std::env::temp_dir().join(format!("dome-caminho-teste-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        let _limpeza =
            pacotes_sociais::PastaTemporaria::nova(raiz.parent().unwrap(), &raiz).unwrap();
        let preparada = instancia_teste(&raiz, "preparacao", "1.20.1");
        let bytes = pacote(
            "modrinth.index.json",
            serde_json::json!({"dependencies": {"minecraft": "1.20.1", "fabric-loader": "0.16.10"}, "files": [{
                "path": "mods/../../fora.jar", "downloads": ["https://example.com/nao-consultar"]
            }]}),
        );
        let erro = modpacks::instalar_arquivos_em_pasta(
            preparada.path,
            String::new(),
            "pacote.zip".into(),
            Some(bytes),
        )
        .await
        .unwrap_err();
        assert!(erro.contains("Caminho inválido"));
        assert!(!raiz.join("fora.jar").exists());
    }
}
