use std::path::{Path, PathBuf};

fn pasta_backups(raiz: &Path) -> Result<PathBuf, String> {
    let pasta = raiz.join(".dome-backups-instancias");
    std::fs::create_dir_all(&pasta).map_err(|erro| erro.to_string())?;
    super::validar_caminho_dentro_raiz(raiz, &pasta)
}

/// Gere o destino na unidade da instância antes de publicar uma alteração com rollback.
pub(crate) fn novo_destino(raiz: &Path) -> Result<PathBuf, String> {
    Ok(pasta_backups(raiz)?.join(uuid::Uuid::new_v4().to_string()))
}

/// Após ativar a nova versão, retenha somente este backup da mesma instância.
pub(crate) fn reter_atual(raiz: &Path, atual: &Path, instancia_id: &str) -> Result<(), String> {
    let pasta = pasta_backups(raiz)?;
    reter_na_pasta(&pasta, atual, instancia_id)
}

/// Retenha o último backup após concluir uma troca de modpack ou atualização compartilhada.
pub(crate) fn reter_atual_social(
    raiz: &Path,
    atual: &Path,
    instancia_id: &str,
) -> Result<(), String> {
    let pasta = super::validar_caminho_dentro_raiz(raiz, &raiz.join(".social-backups"))?;
    reter_na_pasta(&pasta, atual, instancia_id)
}

fn reter_na_pasta(pasta: &Path, atual: &Path, instancia_id: &str) -> Result<(), String> {
    let atual = super::validar_caminho_dentro_raiz(pasta, atual)?;
    let bytes = std::fs::read(atual.join("instance.json")).map_err(|erro| erro.to_string())?;
    let instancia: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|erro| erro.to_string())?;
    if atual.parent() != Some(pasta) || instancia["id"].as_str() != Some(instancia_id) {
        return Err("O backup atual não pertence à instância informada.".into());
    }
    for entrada in std::fs::read_dir(pasta).map_err(|erro| erro.to_string())? {
        let entrada = entrada.map_err(|erro| erro.to_string())?;
        if !entrada
            .file_type()
            .map_err(|erro| erro.to_string())?
            .is_dir()
            || uuid::Uuid::parse_str(&entrada.file_name().to_string_lossy()).is_err()
        {
            continue;
        }
        let caminho = super::validar_caminho_dentro_raiz(pasta, &entrada.path())?;
        if caminho == atual {
            continue;
        }
        let Ok(bytes) = std::fs::read(caminho.join("instance.json")) else {
            continue;
        };
        let Ok(instancia) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        if instancia["id"].as_str() == Some(instancia_id) {
            std::fs::remove_dir_all(&caminho)
                .map_err(|erro| format!("Falha ao remover backup anterior: {erro}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn criar_backup(raiz: &Path, id: &str) -> PathBuf {
        let caminho = novo_destino(raiz).unwrap();
        std::fs::create_dir(&caminho).unwrap();
        std::fs::write(
            caminho.join("instance.json"),
            serde_json::json!({"id": id}).to_string(),
        )
        .unwrap();
        caminho
    }

    #[test]
    fn retencao_preserva_atual_outras_instancias_e_pastas_desconhecidas() {
        let raiz =
            std::env::temp_dir().join(format!("dome-backups-teste-{}", uuid::Uuid::new_v4()));
        let antigo = criar_backup(&raiz, "aventura");
        let outra = criar_backup(&raiz, "outra");
        let atual = criar_backup(&raiz, "aventura");
        let desconhecida = pasta_backups(&raiz).unwrap().join("manual");
        std::fs::create_dir(&desconhecida).unwrap();
        assert!(atual.starts_with(raiz.canonicalize().unwrap()));
        assert!(antigo.exists());
        assert!(reter_atual(&raiz, &outra, "aventura").is_err());
        assert!(antigo.exists());
        reter_atual(&raiz, &atual, "aventura").unwrap();
        assert!(!antigo.exists());
        assert!(atual.exists());
        assert!(outra.exists());
        assert!(desconhecida.exists());
        assert!(reter_atual(&raiz, &raiz.join("ausente"), "aventura").is_err());
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
