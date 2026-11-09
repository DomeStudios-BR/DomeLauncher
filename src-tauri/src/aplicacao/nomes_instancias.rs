use crate::launcher::LauncherState;
use std::path::PathBuf;

/// Adapta um nome ao sistema de arquivos, preservando espaços, maiúsculas e parênteses.
pub(crate) fn preparar_nome_pasta(nome: &str) -> Result<String, String> {
    let base = nome.trim();
    if base.is_empty() {
        return Err("O nome da instância não pode ficar vazio.".into());
    }
    let pasta_base: String = base
        .chars()
        .map(|caractere| {
            if caractere.is_control() || "<>:\"/\\|?*".contains(caractere) {
                '_'
            } else {
                caractere
            }
        })
        .take(80)
        .collect();
    let pasta_base = pasta_base.trim_end_matches(['.', ' ']);
    if pasta_base.is_empty() {
        return Err("O nome não contém caracteres válidos para a pasta.".into());
    }
    let base_reservada = pasta_base.split('.').next().unwrap_or_default();
    let pasta_base =
        if crate::comandos::social_launcher::pacotes_sociais::validar_nome(base_reservada).is_err()
        {
            format!("_{pasta_base}")
        } else {
            pasta_base.to_string()
        };
    Ok(pasta_base)
}

/// Reserva uma pasta exclusiva para cada instalação, considerando nomes exibidos e pastas ocupadas.
pub(crate) fn reservar_copia_modpack(
    state: &LauncherState,
    nome: &str,
) -> Result<(String, String, PathBuf), String> {
    let base = nome.trim();
    let pasta_base = preparar_nome_pasta(base)?;
    let raiz = state.caminho_instancias()?;
    std::fs::create_dir_all(&raiz).map_err(|erro| erro.to_string())?;
    let nomes: std::collections::HashSet<_> = state
        .get_instances()?
        .iter()
        .map(|instancia| instancia.name.to_lowercase())
        .collect();
    for numero in 0u64.. {
        let sufixo = if numero == 0 {
            String::new()
        } else {
            format!(" ({numero})")
        };
        let nome = format!("{base}{sufixo}");
        if nomes.contains(&nome.to_lowercase()) {
            continue;
        }
        let id = format!("{pasta_base}{sufixo}");
        let pasta = raiz.join(&id);
        match std::fs::create_dir(&pasta) {
            Ok(()) => return Ok((nome, id, pasta)),
            Err(erro) if erro.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(erro) => return Err(format!("Erro ao reservar pasta do modpack: {erro}")),
        }
    }
    Err("Não foi possível reservar uma pasta para o modpack.".into())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::comandos::social_launcher::pacotes_sociais::PastaTemporaria;

    #[test]
    fn copias_consideram_pastas_nomes_personalizados_e_reservas_simultaneas() {
        let raiz = std::env::temp_dir().join(format!("dome-copias-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&raiz).unwrap();
        let _limpeza = PastaTemporaria::nova(raiz.parent().unwrap(), &raiz).unwrap();
        let state = LauncherState {
            account: Default::default(),
            accounts: Default::default(),
            processos_instancias: Default::default(),
            instances_path: std::sync::Arc::new(std::sync::Mutex::new(raiz.clone())),
        };
        let (nome, id, pasta) = reservar_copia_modpack(&state, "LostSMP").unwrap();
        assert_eq!(nome, "LostSMP");
        assert_eq!(id, nome);
        assert_eq!(pasta, raiz.join(&nome));
        std::fs::write(pasta.join("original.txt"), b"preservado").unwrap();
        let (_, id, _) = reservar_copia_modpack(&state, "LostSMP").unwrap();
        assert_eq!(id, "LostSMP (1)");
        let antiga = raiz.join("pasta_antiga");
        std::fs::create_dir(&antiga).unwrap();
        std::fs::write(
            antiga.join("instance.json"),
            serde_json::json!({
                "id": "pasta_antiga", "name": "LostSMP (2)", "version": "1.21.1",
                "mcType": "vanilla", "path": antiga, "created": "2026-10-19"
            })
            .to_string(),
        )
        .unwrap();
        let tarefas: Vec<_> = (0..4)
            .map(|_| {
                let state = state.clone();
                std::thread::spawn(move || reservar_copia_modpack(&state, "LostSMP").unwrap())
            })
            .collect();
        let nomes: std::collections::HashSet<_> = tarefas
            .into_iter()
            .map(|tarefa| {
                let (nome, id, pasta) = tarefa.join().unwrap();
                assert_eq!(nome, id);
                assert_eq!(pasta.file_name().unwrap(), nome.as_str());
                nome
            })
            .collect();
        assert_eq!(
            nomes,
            (3..=6)
                .map(|numero| format!("LostSMP ({numero})"))
                .collect()
        );
        assert_eq!(
            std::fs::read(pasta.join("original.txt")).unwrap(),
            b"preservado"
        );
    }

    #[test]
    fn adapta_apenas_restricoes_de_pasta() {
        assert_eq!(preparar_nome_pasta("LostSMP (1)").unwrap(), "LostSMP (1)");
        assert_eq!(preparar_nome_pasta("Pack: 1.21?").unwrap(), "Pack_ 1.21_");
        assert_eq!(preparar_nome_pasta("CON.txt").unwrap(), "_CON.txt");
        assert!(preparar_nome_pasta("...").is_err());
        assert!(preparar_nome_pasta(" ").is_err());
    }
}
