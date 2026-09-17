use super::*;

fn copiar_diretorio(origem: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
    if destino.exists() {
        std::fs::remove_dir_all(destino)
            .map_err(|e| format!("Erro ao limpar {}: {}", destino.display(), e))?;
    }
    if !origem.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(destino)
        .map_err(|e| format!("Erro ao criar {}: {}", destino.display(), e))?;
    for entrada in std::fs::read_dir(origem).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let origem_item = entrada.path();
        let destino_item = destino.join(entrada.file_name());
        if origem_item.is_dir() {
            copiar_diretorio(&origem_item, &destino_item)?;
        } else {
            std::fs::copy(&origem_item, &destino_item)
                .map_err(|e| format!("Erro ao copiar {}: {}", origem_item.display(), e))?;
        }
    }
    Ok(())
}

fn copiar_arquivo(origem: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
    if origem.is_file() {
        std::fs::copy(origem, destino)
            .map_err(|e| format!("Erro ao copiar {}: {}", origem.display(), e))?;
    } else if destino.exists() {
        std::fs::remove_file(destino)
            .map_err(|e| format!("Erro ao remover {}: {}", destino.display(), e))?;
    }
    Ok(())
}

pub(super) fn aplicar_sincronizacao_em_destino(
    origem: &std::path::Path,
    destino: &std::path::Path,
    configuracao: &crate::comandos::configuracoes_java::ConfiguracaoSincronizacaoInstancias,
) -> Result<(), String> {
    if configuracao.configuracoes {
        copiar_diretorio(&origem.join("config"), &destino.join("config"))?;
    }
    if configuracao.opcoes {
        copiar_arquivo(&origem.join("options.txt"), &destino.join("options.txt"))?;
    }
    if configuracao.texturas {
        copiar_diretorio(
            &origem.join("resourcepacks"),
            &destino.join("resourcepacks"),
        )?;
    }
    if configuracao.shaders {
        copiar_diretorio(&origem.join("shaderpacks"), &destino.join("shaderpacks"))?;
    }
    if configuracao.servidores {
        copiar_arquivo(&origem.join("servers.dat"), &destino.join("servers.dat"))?;
    }
    Ok(())
}

pub(super) fn aplicar_sincronizacao_nova_instancia(
    destino: &std::path::Path,
) -> Result<(), String> {
    let configuracoes = crate::comandos::configuracoes_java::carregar_configuracoes_locais()?;
    let sync = configuracoes.sincronizacao_instancias;
    let Some(origem_id) = sync.instancia_origem_id.as_deref() else {
        return Ok(());
    };
    let raiz = std::fs::canonicalize(&configuracoes.instances_path)
        .map_err(|e| format!("Erro ao validar a pasta de instâncias: {}", e))?;
    let origem = std::fs::canonicalize(raiz.join(origem_id))
        .map_err(|_| "A instância de origem da sincronização não está disponível.".to_string())?;
    if !origem.starts_with(&raiz) {
        return Err("A instância de origem da sincronização é inválida.".to_string());
    }
    if origem == destino || !origem.join("instance.json").is_file() {
        return Ok(());
    }
    aplicar_sincronizacao_em_destino(&origem, destino, &sync)
}

pub(super) fn aplicar_sincronizacao_antes_de_jogar(
    destino: &std::path::Path,
) -> Result<(), String> {
    aplicar_sincronizacao_nova_instancia(destino)
}

#[tauri::command]
pub(crate) async fn aplicar_sincronizacao_instancias(
    state: State<'_, LauncherState>,
) -> Result<usize, String> {
    let configuracoes = crate::comandos::configuracoes_java::carregar_configuracoes_locais()?;
    let sync = configuracoes.sincronizacao_instancias;
    let origem_id = sync
        .instancia_origem_id
        .as_deref()
        .ok_or("Escolha uma instância de origem para a sincronização.")?;
    let origem = caminho_instancia_por_id(&state, origem_id)?;
    if !origem.join("instance.json").is_file() {
        return Err("A instância de origem não está mais disponível.".to_string());
    }
    let destinos = state
        .get_instances()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|instancia| instancia.id != origem_id)
        .map(|instancia| instancia.path)
        .collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || {
        for destino in &destinos {
            aplicar_sincronizacao_em_destino(&origem, destino, &sync)?;
        }
        Ok(destinos.len())
    })
    .await
    .map_err(|e| format!("Falha ao sincronizar instâncias: {}", e))?
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn copia_apenas_categorias_selecionadas() {
        let raiz = std::env::temp_dir().join(format!("dome-sync-{}", uuid::Uuid::new_v4()));
        let origem = raiz.join("origem");
        let destino = raiz.join("destino");
        std::fs::create_dir_all(origem.join("config")).unwrap();
        std::fs::create_dir_all(destino.join("shaderpacks")).unwrap();
        std::fs::write(origem.join("config").join("mod.toml"), "origem").unwrap();
        std::fs::write(origem.join("options.txt"), "gamma:1.0").unwrap();
        std::fs::write(destino.join("options.txt"), "gamma:0.5").unwrap();
        std::fs::write(destino.join("shaderpacks").join("local.zip"), "local").unwrap();
        let configuracao =
            crate::comandos::configuracoes_java::ConfiguracaoSincronizacaoInstancias {
                configuracoes: true,
                opcoes: true,
                ..Default::default()
            };

        aplicar_sincronizacao_em_destino(&origem, &destino, &configuracao).unwrap();

        assert_eq!(
            std::fs::read_to_string(destino.join("config").join("mod.toml")).unwrap(),
            "origem"
        );
        assert_eq!(
            std::fs::read_to_string(destino.join("options.txt")).unwrap(),
            "gamma:1.0"
        );
        assert!(destino.join("shaderpacks").join("local.zip").is_file());
        let _ = std::fs::remove_dir_all(raiz);
    }
}
