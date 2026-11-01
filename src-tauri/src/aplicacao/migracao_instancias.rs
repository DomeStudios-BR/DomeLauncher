use super::instancias_criacao::{
    install_fabric_loader, install_forge_loader, install_neoforge_loader,
};
use super::mods_migracao_estado::ModsDesativados;
use super::reserva_instancia::ReservaInstancia;
use super::*;
use sha2::{Digest, Sha512};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoMigracaoVersao {
    versao_anterior: String,
    versao_nova: String,
    mods_migrados: usize,
    mods_desativados: Vec<String>,
    mods_preservados_backup: Vec<String>,
    caminho_backup: String,
}

fn copiar_diretorio(origem: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(destino)
        .map_err(|e| format!("Erro ao criar {}: {}", destino.display(), e))?;
    for entrada in
        std::fs::read_dir(origem).map_err(|e| format!("Erro ao ler {}: {}", origem.display(), e))?
    {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let caminho_origem = entrada.path();
        let caminho_destino = destino.join(entrada.file_name());
        if entrada
            .file_type()
            .map_err(|erro| erro.to_string())?
            .is_symlink()
        {
            return Err(format!(
                "A migração não pode copiar o link {}.",
                caminho_origem.display()
            ));
        }
        if caminho_origem.is_dir() {
            copiar_diretorio(&caminho_origem, &caminho_destino)?;
        } else {
            std::fs::copy(&caminho_origem, &caminho_destino)
                .map_err(|e| format!("Erro ao copiar {}: {}", caminho_origem.display(), e))?;
        }
    }
    Ok(())
}

fn preservar_mods_desativados(
    origem: &std::path::Path,
    destino: &std::path::Path,
    migrados: &std::collections::HashSet<String>,
) -> Result<Vec<String>, String> {
    std::fs::create_dir_all(destino).map_err(|erro| erro.to_string())?;
    if !origem.is_dir() {
        return Ok(Vec::new());
    }
    let mut desativados = Vec::new();
    for entrada in std::fs::read_dir(origem).map_err(|erro| erro.to_string())? {
        let entrada = entrada.map_err(|erro| erro.to_string())?;
        let nome = entrada.file_name().to_string_lossy().to_string();
        if migrados.contains(&nome) {
            continue;
        }
        let tipo = entrada.file_type().map_err(|erro| erro.to_string())?;
        if tipo.is_symlink() {
            return Err("Link não permitido na pasta de mods.".into());
        }
        if tipo.is_dir() {
            let filhos = preservar_mods_desativados(
                &entrada.path(),
                &destino.join(&nome),
                &std::collections::HashSet::new(),
            )?;
            desativados.extend(
                filhos
                    .into_iter()
                    .map(|arquivo| format!("{nome}/{arquivo}")),
            );
            continue;
        }
        let nome_destino = if nome.to_lowercase().ends_with(".jar") {
            format!("{nome}.disabled")
        } else {
            nome.clone()
        };
        let alvo = destino.join(&nome_destino);
        if alvo.exists()
            && std::fs::read(&alvo).map_err(|erro| erro.to_string())?
                != std::fs::read(entrada.path()).map_err(|erro| erro.to_string())?
        {
            return Err(format!(
                "Conflito ao preservar {nome_destino}. A instância foi mantida."
            ));
        }
        std::fs::copy(entrada.path(), &alvo).map_err(|erro| erro.to_string())?;
        if nome_destino.to_lowercase().ends_with(".jar.disabled") {
            desativados.push(nome_destino);
        }
    }
    desativados.sort();
    Ok(desativados)
}

fn publicar_migracao(
    preparada: &std::path::Path,
    atual: &std::path::Path,
    backup: &std::path::Path,
    conferir: impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    conferir()?;
    let reserva = match std::fs::rename(atual, backup) {
        Ok(()) => backup.to_path_buf(),
        Err(erro) if erro.kind() == std::io::ErrorKind::CrossesDevices => {
            copiar_diretorio(atual, backup)?;
            conferir()?;
            let reserva = atual.with_file_name(format!(".dome-anterior-{}", uuid::Uuid::new_v4()));
            std::fs::rename(atual, &reserva).map_err(|erro| erro.to_string())?;
            reserva
        }
        Err(erro) => return Err(format!("Erro ao guardar a versão anterior: {erro}")),
    };
    if let Err(erro) = std::fs::rename(preparada, atual) {
        std::fs::rename(&reserva, atual).map_err(|restauracao| {
            format!(
                "Falha ao ativar: {erro}. Falha ao restaurar: {restauracao}. Backup: {}",
                backup.display()
            )
        })?;
        return Err(format!(
            "Erro ao ativar a nova versão; a anterior foi restaurada: {erro}"
        ));
    }
    if reserva != backup {
        let _ = std::fs::remove_dir_all(reserva);
    }
    Ok(())
}

fn hash_sha512_arquivo(caminho: &std::path::Path) -> Result<String, String> {
    let bytes =
        std::fs::read(caminho).map_err(|e| format!("Erro ao ler {}: {}", caminho.display(), e))?;
    Ok(format!("{:x}", Sha512::digest(bytes)))
}

async fn identificar_mods_modrinth(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
) -> Result<Vec<(String, String, bool)>, String> {
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }
    let pasta = mods_dir.to_path_buf();
    let hashes = tauri::async_runtime::spawn_blocking(move || {
        let arquivos = std::fs::read_dir(&pasta)
            .map_err(|e| format!("Erro ao listar mods: {}", e))?
            .flatten()
            .filter_map(|entrada| {
                let nome = entrada.file_name().to_string_lossy().to_string();
                let minusculo = nome.to_lowercase();
                (entrada.path().is_file()
                    && (minusculo.ends_with(".jar") || minusculo.ends_with(".jar.disabled")))
                .then_some((nome, entrada.path(), minusculo.ends_with(".disabled")))
            })
            .collect::<Vec<_>>();
        arquivos
            .into_iter()
            .map(|(nome, caminho, desabilitado)| {
                Ok((nome, hash_sha512_arquivo(&caminho)?, desabilitado))
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|e| format!("Falha ao analisar os mods: {}", e))??;
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let resposta = client
        .post(format!("{}/version_files", MODRINTH_API_BASE))
        .header("User-Agent", "DomeLauncher/1.0")
        .json(&serde_json::json!({
            "hashes": hashes.iter().map(|(_, hash, _)| hash).collect::<Vec<_>>(),
            "algorithm": "sha512"
        }))
        .send()
        .await
        .map_err(|e| format!("Erro ao identificar mods no Modrinth: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "Modrinth retornou {} ao identificar mods.",
            resposta.status()
        ));
    }
    let encontrados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida do Modrinth: {}", e))?;
    Ok(hashes
        .into_iter()
        .filter_map(|(nome, hash, desabilitado)| {
            encontrados[&hash]["project_id"]
                .as_str()
                .map(|id| (nome, id.to_string(), desabilitado))
        })
        .collect())
}

fn fingerprint_curseforge(caminho: &std::path::Path) -> Result<u32, String> {
    let bytes =
        std::fs::read(caminho).map_err(|e| format!("Erro ao ler {}: {}", caminho.display(), e))?;
    let normalizados = bytes
        .into_iter()
        .filter(|byte| !matches!(byte, 9 | 10 | 13 | 32))
        .collect::<Vec<_>>();
    let mut hash = 1u32 ^ normalizados.len() as u32;
    let constante = 0x5bd1e995u32;
    let (blocos, restante) = normalizados.as_chunks::<4>();
    for bloco in blocos {
        let mut valor = u32::from_le_bytes(*bloco);
        valor = valor.wrapping_mul(constante);
        valor ^= valor >> 24;
        valor = valor.wrapping_mul(constante);
        hash = hash.wrapping_mul(constante) ^ valor;
    }
    if restante.len() >= 3 {
        hash ^= (restante[2] as u32) << 16;
    }
    if restante.len() >= 2 {
        hash ^= (restante[1] as u32) << 8;
    }
    if let Some(primeiro) = restante.first() {
        hash ^= *primeiro as u32;
        hash = hash.wrapping_mul(constante);
    }
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(constante);
    hash ^= hash >> 15;
    Ok(hash)
}

async fn identificar_mods_curseforge(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
    ignorar: &std::collections::HashSet<String>,
) -> Result<Vec<(String, String, bool)>, String> {
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }
    let pasta = mods_dir.to_path_buf();
    let ignorar = ignorar.clone();
    let fingerprints = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_dir(&pasta)
            .map_err(|e| format!("Erro ao listar mods: {}", e))?
            .flatten()
            .filter_map(|entrada| {
                let nome = entrada.file_name().to_string_lossy().to_string();
                let minusculo = nome.to_lowercase();
                (entrada.path().is_file()
                    && !ignorar.contains(&nome)
                    && (minusculo.ends_with(".jar") || minusculo.ends_with(".jar.disabled")))
                .then_some((nome, entrada.path(), minusculo.ends_with(".disabled")))
            })
            .map(|(nome, caminho, desabilitado)| {
                Ok((nome, fingerprint_curseforge(&caminho)?, desabilitado))
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|e| format!("Falha ao analisar os mods: {}", e))??;
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }
    let resposta = super::anexar_headers_curseforge(
        client
            .post(format!("{}/fingerprints", super::CURSEFORGE_API_BASE))
            .json(&serde_json::json!({
                "fingerprints": fingerprints.iter().map(|(_, valor, _)| valor).collect::<Vec<_>>()
            })),
    )?
    .send()
    .await
    .map_err(|e| format!("Erro ao identificar mods no CurseForge: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou {} ao identificar mods.",
            resposta.status()
        ));
    }
    let payload = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida do CurseForge: {}", e))?;
    let encontrados = payload["data"]["exactMatches"]
        .as_array()
        .ok_or("CurseForge não retornou os resultados de identificação.")?;
    let projetos = encontrados
        .iter()
        .filter_map(|item| {
            Some((
                u32::try_from(item["file"]["fileFingerprint"].as_u64()?).ok()?,
                item["file"]["modId"].as_u64()?.to_string(),
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();
    Ok(fingerprints
        .into_iter()
        .filter_map(|(nome, fingerprint, desabilitado)| {
            projetos
                .get(&fingerprint)
                .cloned()
                .map(|id| (nome, id, desabilitado))
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn migrar_versao_instancia(
    state: State<'_, LauncherState>,
    instance_id: String,
    version: String,
    loader_type: String,
    loader_version: Option<String>,
    progresso: crate::comandos::progresso_operacao::CanalProgresso,
) -> Result<ResultadoMigracaoVersao, String> {
    let acompanhamento = crate::comandos::progresso_operacao::Acompanhamento::novo(progresso.0);
    acompanhamento.informar("Preparando migração", 0, 1);
    let mut instancia = obter_instancia_por_id(&state, &instance_id)?;
    if state.obter_pid_instancia(&instance_id).is_some() {
        return Err("Feche o jogo antes de alterar Minecraft ou loader.".into());
    }
    let raiz = state.caminho_instancias()?;
    let _reserva = ReservaInstancia::nova(&raiz, &instancia.path)?;
    let loader = loader_type.trim().to_lowercase();
    if !matches!(loader.as_str(), "vanilla" | "fabric" | "forge" | "neoforge") {
        return Err("Loader não suportado para migração.".to_string());
    }
    if version.trim().is_empty() {
        return Err("Selecione uma versão do Minecraft.".to_string());
    }
    if loader != "vanilla" && loader_version.as_deref().is_none_or(str::is_empty) {
        return Err("Selecione uma versão do loader.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("DomeLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let manifesto = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;
    let entrada = manifesto
        .versions
        .iter()
        .find(|item| item.id == version)
        .ok_or("Versão do Minecraft não encontrada.")?;
    let detalhes = client
        .get(&entrada.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    let temporario = instancia
        .path
        .with_file_name(format!(".dome-migracao-{}", uuid::Uuid::new_v4()));
    let origem_copia = instancia.path.clone();
    let destino_copia = temporario.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(erro) = copiar_diretorio(&origem_copia, &destino_copia) {
            let _ = std::fs::remove_dir_all(&destino_copia);
            return Err(erro);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Falha ao copiar a instância para migração: {}", e))??;
    let _limpeza = crate::comandos::social_launcher::pacotes_sociais::PastaTemporaria::nova(
        &raiz,
        &temporario,
    )?;
    for manifesto in [
        "fabric_manifest.json",
        "forge_manifest.json",
        "neoforge_manifest.json",
    ] {
        let caminho = temporario.join(manifesto);
        if caminho.exists() {
            std::fs::remove_file(caminho).map_err(|erro| erro.to_string())?;
        }
    }
    let mods_temporarios = temporario.join("mods");
    if mods_temporarios.exists() {
        std::fs::remove_dir_all(&mods_temporarios)
            .map_err(|e| format!("Erro ao preparar a migração dos mods: {}", e))?;
    }
    let preparar = async {
        super::downloads_instancias::download_instance_files_com_progresso(
            &temporario,
            &detalhes,
            &acompanhamento.faixa(5, 65),
        )
        .await?;
        std::fs::write(
            temporario.join("version_manifest.json"),
            serde_json::to_string_pretty(&detalhes).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        match loader.as_str() {
            "fabric" => {
                install_fabric_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            "forge" => {
                install_forge_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            "neoforge" => {
                install_neoforge_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            _ => {}
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(erro) = preparar {
        let _ = std::fs::remove_dir_all(&temporario);
        return Err(erro);
    }

    let mods_atuais = instancia.path.join("mods");
    let mods_identificados = match identificar_mods_modrinth(&client, &mods_atuais).await {
        Ok(mods) => mods,
        Err(erro) => {
            let _ = std::fs::remove_dir_all(&temporario);
            return Err(erro);
        }
    };
    let reconhecidos = mods_identificados
        .iter()
        .map(|(nome, _, _)| nome.clone())
        .collect();
    let mods_curseforge =
        match identificar_mods_curseforge(&client, &mods_atuais, &reconhecidos).await {
            Ok(mods) => mods,
            Err(erro) => {
                let _ = std::fs::remove_dir_all(&temporario);
                return Err(erro);
            }
        };
    let mods_novos = temporario.join("mods");
    let loader_normalizado = (loader != "vanilla").then(|| loader.clone());
    let mut migrados = 0usize;
    let mut nomes_migrados = std::collections::HashSet::new();
    let pasta_mods = mods_atuais.clone();
    let mut mods_desativados =
        tauri::async_runtime::spawn_blocking(move || ModsDesativados::carregar(&pasta_mods))
            .await
            .map_err(|erro| erro.to_string())??;
    let candidatos = mods_identificados
        .into_iter()
        .map(|item| (item, false))
        .chain(mods_curseforge.into_iter().map(|item| (item, true)))
        .collect::<Vec<_>>();
    let total_mods = candidatos.len() as u64;
    for (indice, ((nome, projeto, desabilitado), curseforge)) in candidatos.into_iter().enumerate()
    {
        acompanhamento
            .faixa(65, 90)
            .informar("Atualizando mods", indice as u64, total_mods);
        if loader == "vanilla" {
            continue;
        }
        if let Some(arquivo) = super::mods_conteudo::repetir_preparacao_mod(|| {
            super::mods_conteudo::instalar_mod_migracao(
                &client,
                &mods_novos,
                projeto.clone(),
                curseforge,
                &version,
                &loader_normalizado,
            )
        })
        .await?
        {
            if desabilitado {
                mods_desativados.registrar(&mods_novos.join(&arquivo));
            }
            migrados += 1;
            nomes_migrados.insert(nome);
        }
    }
    let origem = mods_atuais.clone();
    let destino = mods_novos.clone();
    let desativados = tauri::async_runtime::spawn_blocking(move || {
        mods_desativados.aplicar(&destino)?;
        preservar_mods_desativados(&origem, &destino, &nomes_migrados)
    })
    .await
    .map_err(|erro| erro.to_string())??;
    let preservados = desativados
        .iter()
        .map(|nome| {
            if mods_atuais.join(nome).is_file() {
                nome.clone()
            } else {
                nome.strip_suffix(".disabled").unwrap_or(nome).to_string()
            }
        })
        .collect();
    let backup = super::backups_instancias::novo_destino(&raiz)?;

    let versao_anterior = instancia.version.clone();
    instancia.version = version.clone();
    instancia.mc_type = if loader == "vanilla" {
        "Vanilla".into()
    } else {
        "Modded".into()
    };
    instancia.loader_type = Some(
        match loader.as_str() {
            "fabric" => "Fabric",
            "forge" => "Forge",
            "neoforge" => "NeoForge",
            _ => "Vanilla",
        }
        .to_string(),
    );
    instancia.loader_version = if loader == "vanilla" {
        None
    } else {
        loader_version
    };
    std::fs::write(
        temporario.join("instance.json"),
        serde_json::to_string_pretty(&instancia).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    if state.obter_pid_instancia(&instance_id).is_some() {
        return Err("Feche o jogo antes de concluir a alteração.".into());
    }
    let preparada = temporario.clone();
    let atual = instancia.path.clone();
    let backup_publicacao = backup.clone();
    let processos = state.processos_instancias.clone();
    let id_backup = instancia.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        publicar_migracao(&preparada, &atual, &backup_publicacao, || {
            if processos
                .lock()
                .map_err(|erro| erro.to_string())?
                .contains_key(&instance_id)
            {
                return Err("Feche o jogo antes de concluir a alteração.".into());
            }
            Ok(())
        })?;
        if let Err(erro) =
            super::backups_instancias::reter_atual(&raiz, &backup_publicacao, &id_backup)
        {
            eprintln!("[Backups] {erro}");
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|erro| erro.to_string())??;

    acompanhamento.concluir("Migração concluída");
    Ok(ResultadoMigracaoVersao {
        versao_anterior,
        versao_nova: version,
        mods_migrados: migrados,
        mods_preservados_backup: preservados,
        mods_desativados: desativados,
        caminho_backup: backup.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    #[ignore = "requer duas unidades; DOME_TESTE_UNIDADE_DESTINO indica a pasta de teste na segunda"]
    fn publica_entre_unidades_com_backup_e_preserva_original_se_jogo_abre() {
        let destino = std::env::var_os("DOME_TESTE_UNIDADE_DESTINO")
            .expect("Informe a pasta na outra unidade");
        let destino = std::path::PathBuf::from(destino).canonicalize().unwrap();
        let raiz =
            std::env::temp_dir().join(format!("dome-migracao-origem-{}", uuid::Uuid::new_v4()));
        let outra = destino.join(format!("dome-migracao-destino-{}", uuid::Uuid::new_v4()));
        let atual = raiz.join("atual");
        let preparada = raiz.join("preparada");
        let backup = outra.join("backup");
        std::fs::create_dir_all(&atual).unwrap();
        std::fs::create_dir_all(&outra).unwrap();
        std::fs::create_dir_all(&preparada).unwrap();
        std::fs::write(atual.join("mod.jar"), "antigo").unwrap();
        std::fs::write(preparada.join("mod.jar"), "novo").unwrap();
        let prova = atual.join("mod.jar");
        assert_eq!(
            std::fs::rename(&prova, outra.join("prova"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::CrossesDevices
        );
        assert!(
            publicar_migracao(&preparada, &atual, &backup, || Err("Jogo aberto".into())).is_err()
        );
        assert_eq!(std::fs::read_to_string(&prova).unwrap(), "antigo");
        publicar_migracao(&preparada, &atual, &backup, || Ok(())).unwrap();
        assert_eq!(
            std::fs::read_to_string(atual.join("mod.jar")).unwrap(),
            "novo"
        );
        assert_eq!(
            std::fs::read_to_string(backup.join("mod.jar")).unwrap(),
            "antigo"
        );
        assert!(outra.canonicalize().unwrap().starts_with(&destino));
        assert!(raiz
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(raiz).unwrap();
        std::fs::remove_dir_all(outra).unwrap();
    }

    #[test]
    fn preserva_incompativeis_desativados_e_dados_pessoais_ao_publicar() {
        let raiz =
            std::env::temp_dir().join(format!("dome-migracao-teste-{}", uuid::Uuid::new_v4()));
        let atual = raiz.join("atual");
        let preparada = raiz.join("preparada");
        let backup = raiz.join("backup");
        for pasta in [
            "mods/legado",
            "saves/mundo",
            "config",
            "resourcepacks",
            "shaderpacks",
        ] {
            std::fs::create_dir_all(atual.join(pasta)).unwrap();
        }
        for arquivo in [
            "mods/antigo.jar",
            "mods/sem-versao.jar",
            "mods/desligado.jar.disabled",
            "mods/legado/outro.jar",
            "saves/mundo/level.dat",
            "config/opcoes.toml",
            "options.txt",
            "servers.dat",
            "resourcepacks/textura.zip",
            "shaderpacks/shader.zip",
            "modpack.json",
        ] {
            std::fs::write(atual.join(arquivo), arquivo).unwrap();
        }
        copiar_diretorio(&atual, &preparada).unwrap();
        std::fs::remove_dir_all(preparada.join("mods")).unwrap();
        std::fs::create_dir(preparada.join("mods")).unwrap();
        std::fs::write(preparada.join("mods/novo.jar"), "versão nova").unwrap();
        let desativados = preservar_mods_desativados(
            &atual.join("mods"),
            &preparada.join("mods"),
            &std::collections::HashSet::from(["antigo.jar".into()]),
        )
        .unwrap();
        assert_eq!(
            desativados,
            [
                "desligado.jar.disabled",
                "legado/outro.jar.disabled",
                "sem-versao.jar.disabled"
            ]
        );
        publicar_migracao(&preparada, &atual, &backup, || Ok(())).unwrap();
        assert!(atual.join("mods/novo.jar").exists());
        assert!(!atual.join("mods/antigo.jar").exists());
        assert!(!atual.join("mods/sem-versao.jar").exists());
        assert_eq!(
            std::fs::read_to_string(atual.join("mods/sem-versao.jar.disabled")).unwrap(),
            "mods/sem-versao.jar"
        );
        assert!(backup.join("mods/antigo.jar").exists());
        for arquivo in [
            "saves/mundo/level.dat",
            "config/opcoes.toml",
            "options.txt",
            "servers.dat",
            "resourcepacks/textura.zip",
            "shaderpacks/shader.zip",
            "modpack.json",
        ] {
            assert_eq!(
                std::fs::read(atual.join(arquivo)).unwrap(),
                std::fs::read(backup.join(arquivo)).unwrap()
            );
        }
        std::fs::remove_dir_all(raiz).unwrap();
    }

    #[test]
    fn restaura_instancia_quando_publicacao_falha() {
        let raiz =
            std::env::temp_dir().join(format!("dome-migracao-falha-{}", uuid::Uuid::new_v4()));
        let atual = raiz.join("atual");
        std::fs::create_dir_all(&atual).unwrap();
        std::fs::write(atual.join("original"), "preservado").unwrap();
        assert!(
            publicar_migracao(&raiz.join("ausente"), &atual, &raiz.join("backup"), || Ok(
                ()
            ))
            .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(atual.join("original")).unwrap(),
            "preservado"
        );
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
