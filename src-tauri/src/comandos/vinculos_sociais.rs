use super::pacotes_sociais::{self, ArquivoSocial};
use crate::launcher::{Instance, LauncherState};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VinculoSocial {
    pub compartilhamento_id: String,
    pub api_base_url: String,
    pub versao: u32,
    pub arquivos: Vec<ArquivoSocial>,
    #[serde(default)]
    pub substituir_alteracoes_locais: bool,
}

pub fn buscar(
    state: &LauncherState,
    base: &str,
    id: &str,
) -> Result<Option<(Instance, VinculoSocial)>, String> {
    for instancia in state.get_instances().map_err(|e| e.to_string())? {
        let Ok(bytes) = std::fs::read(instancia.path.join("compartilhamento.json")) else {
            continue;
        };
        let Ok(vinculo) = serde_json::from_slice::<VinculoSocial>(&bytes) else {
            continue;
        };
        if vinculo.compartilhamento_id == id && vinculo.api_base_url == base {
            return Ok(Some((instancia, vinculo)));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn revisar_atualizacao_compartilhada(
    api_base_url: String,
    compartilhamento_id: String,
    arquivos: Vec<ArquivoSocial>,
    state: State<'_, LauncherState>,
) -> Result<serde_json::Value, String> {
    let existente = buscar(&state, &api_base_url, &compartilhamento_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some((instancia, vinculo)) = existente else {
            return Ok(serde_json::json!({ "instanciaId": null, "versao": 0, "conflitos": [],
                "adicionados": arquivos.iter().map(|a| &a.caminho).collect::<Vec<_>>(), "removidos": [], "alterados": [] }));
        };
        let locais = pacotes_sociais::previa(&instancia)?.arquivos;
        let mut conflitos: Vec<_> = vinculo.arquivos.iter().filter(|antigo| {
            let local = locais.iter().find(|a| a.caminho == antigo.caminho);
            let novo = arquivos.iter().find(|a| a.caminho == antigo.caminho);
            local.map(|a| &a.sha256) != Some(&antigo.sha256)
                && local.map(|a| &a.sha256) != novo.map(|a| &a.sha256)
        }).map(|a| a.caminho.clone()).collect();
        conflitos.extend(arquivos.iter().filter(|novo| !vinculo.arquivos.iter().any(|a| a.caminho == novo.caminho)
            && locais.iter().any(|a| a.caminho == novo.caminho && a.sha256 != novo.sha256)).map(|a| a.caminho.clone()));
        Ok(serde_json::json!({ "instanciaId": instancia.id, "versao": vinculo.versao, "conflitos": conflitos,
            "adicionados": arquivos.iter().filter(|a| !vinculo.arquivos.iter().any(|b| a.caminho == b.caminho)).map(|a| &a.caminho).collect::<Vec<_>>(),
            "removidos": vinculo.arquivos.iter().filter(|a| !arquivos.iter().any(|b| a.caminho == b.caminho)).map(|a| &a.caminho).collect::<Vec<_>>(),
            "alterados": arquivos.iter().filter(|a| vinculo.arquivos.iter().any(|b| a.caminho == b.caminho && a.sha256 != b.sha256)).map(|a| &a.caminho).collect::<Vec<_>>()
        }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn desvincular_instancia_compartilhada(
    api_base_url: String,
    compartilhamento_id: String,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    if let Some((instancia, _)) = buscar(&state, &api_base_url, &compartilhamento_id)? {
        std::fs::remove_file(instancia.path.join("compartilhamento.json"))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn preservar_pessoais(
    raiz: &Path,
    pasta: &Path,
    destino: &Path,
    gerenciados: &[ArquivoSocial],
) -> Result<(), String> {
    for entrada in std::fs::read_dir(pasta).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let relativo = entrada
            .path()
            .strip_prefix(raiz)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        let nome = relativo.to_string_lossy().replace('\\', "/");
        let primeiro = nome.split('/').next().unwrap_or_default();
        if [
            "instance.json",
            "compartilhamento.json",
            "versions",
            "libraries",
            "assets",
            "natives",
            "logs",
            "crash-reports",
        ]
        .contains(&primeiro)
            || gerenciados.iter().any(|a| a.caminho == nome)
        {
            continue;
        }
        let tipo = entrada.file_type().map_err(|e| e.to_string())?;
        if tipo.is_symlink() {
            return Err("Remova links simbólicos antes de atualizar a instância.".into());
        }
        let alvo = destino.join(&relativo);
        if tipo.is_dir() {
            std::fs::create_dir_all(&alvo).map_err(|e| e.to_string())?;
            preservar_pessoais(raiz, &entrada.path(), destino, gerenciados)?;
        } else if tipo.is_file() && !alvo.exists() {
            std::fs::copy(entrada.path(), alvo).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn publicar_local(
    state: &LauncherState,
    mut preparada: Instance,
    vinculo: Option<VinculoSocial>,
) -> Result<Instance, String> {
    let raiz = state.caminho_instancias()?;
    let origem = preparada.path.clone();
    let existente = match &vinculo {
        Some(v) => buscar(state, &v.api_base_url, &v.compartilhamento_id)?,
        None => None,
    };
    let mut backup = None;
    if let Some((antiga, anterior)) = &existente {
        if state.obter_pid_instancia(&antiga.id).is_some() {
            return Err("Feche o jogo antes de atualizar.".into());
        }
        let novo = vinculo.as_ref().ok_or("Vínculo ausente.")?;
        let locais = pacotes_sociais::previa(antiga)?.arquivos;
        let conflito = anterior.arquivos.iter().any(|a| {
            let local = locais
                .iter()
                .find(|l| l.caminho == a.caminho)
                .map(|l| &l.sha256);
            let desejado = novo
                .arquivos
                .iter()
                .find(|n| n.caminho == a.caminho)
                .map(|n| &n.sha256);
            local != Some(&a.sha256) && local != desejado
        }) || novo.arquivos.iter().any(|n| {
            !anterior.arquivos.iter().any(|a| a.caminho == n.caminho)
                && locais
                    .iter()
                    .any(|l| l.caminho == n.caminho && l.sha256 != n.sha256)
        });
        if conflito && !novo.substituir_alteracoes_locais {
            return Err(
                "Arquivos locais foram alterados. Revise os conflitos antes de atualizar.".into(),
            );
        }
        preservar_pessoais(&antiga.path, &antiga.path, &origem, &anterior.arquivos)?;
        preparada.id = antiga.id.clone();
        preparada.name = antiga.name.clone();
        preparada.created = antiga.created.clone();
        preparada.last_played = antiga.last_played.clone();
        preparada.tempo_total_jogado_segundos = antiga.tempo_total_jogado_segundos;
        preparada.memory = antiga.memory;
        preparada.java_args = antiga.java_args.clone();
        preparada.mc_args = antiga.mc_args.clone();
        preparada.width = antiga.width;
        preparada.height = antiga.height;
        let pasta_backup = raiz.join(".social-backups");
        std::fs::create_dir_all(&pasta_backup).map_err(|e| e.to_string())?;
        backup = Some(pasta_backup.join(uuid::Uuid::new_v4().to_string()));
    } else if raiz.join(&preparada.id).exists() {
        preparada.id = format!("{}-{}", preparada.id, uuid::Uuid::new_v4());
    }
    preparada.path = raiz.join(&preparada.id);
    std::fs::write(
        origem.join("instance.json"),
        serde_json::to_vec_pretty(&preparada).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Some(vinculo) = vinculo {
        std::fs::write(
            origem.join("compartilhamento.json"),
            serde_json::to_vec(&vinculo).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(backup) = &backup {
        std::fs::rename(&preparada.path, backup).map_err(|e| e.to_string())?;
    }
    if let Err(erro) = std::fs::rename(&origem, &preparada.path) {
        if let Some(backup) = &backup {
            std::fs::rename(backup, &preparada.path).map_err(|e| {
                format!(
                    "Falha ao restaurar instância: {e}. Backup em {}",
                    backup.display()
                )
            })?;
        }
        return Err(erro.to_string());
    }
    Ok(preparada)
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn instancia(raiz: &Path, id: &str, conteudo: &[u8]) -> Instance {
        let pasta = raiz.join(id);
        std::fs::create_dir_all(pasta.join("mods")).unwrap();
        std::fs::write(pasta.join("mods/exemplo.jar"), conteudo).unwrap();
        let instancia: Instance = serde_json::from_value(serde_json::json!({
            "id": id, "name": "Meu nome", "version": "1.21.1", "mcType": "vanilla", "path": pasta,
            "created": "2026-09-13", "memory": 4096
        }))
        .unwrap();
        std::fs::write(
            pasta.join("instance.json"),
            serde_json::to_vec(&instancia).unwrap(),
        )
        .unwrap();
        instancia
    }

    #[test]
    fn atualiza_mesmo_id_preserva_pessoais_e_exige_aceite_de_conflitos() {
        let raiz =
            std::env::temp_dir().join(format!("dome-teste-vinculo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        let _limpeza =
            pacotes_sociais::PastaTemporaria::nova(&std::env::temp_dir(), &raiz).unwrap();
        let state = LauncherState {
            account: Default::default(),
            accounts: Default::default(),
            instances_path: Arc::new(Mutex::new(raiz.clone())),
            processos_instancias: Default::default(),
        };
        let antiga = instancia(&raiz, "original", b"antigo");
        let vinculo = VinculoSocial {
            compartilhamento_id: "teste".into(),
            api_base_url: "https://api.example.com".into(),
            versao: 1,
            arquivos: pacotes_sociais::previa(&antiga).unwrap().arquivos,
            substituir_alteracoes_locais: false,
        };
        std::fs::write(
            antiga.path.join("compartilhamento.json"),
            serde_json::to_vec(&vinculo).unwrap(),
        )
        .unwrap();
        std::fs::write(antiga.path.join("options.txt"), b"minhas opcoes").unwrap();
        std::fs::create_dir_all(antiga.path.join("saves")).unwrap();
        std::fs::write(antiga.path.join("saves/mundo.dat"), b"meu mundo").unwrap();
        std::fs::write(antiga.path.join("mods/pessoal.jar"), b"mod pessoal").unwrap();
        std::fs::write(
            antiga.path.join("mods/exemplo.jar"),
            b"modificado localmente",
        )
        .unwrap();
        let preparada = instancia(&raiz.join(".preparacao"), "nova", b"atualizado");
        let mut novo = VinculoSocial {
            versao: 2,
            arquivos: pacotes_sociais::previa(&preparada).unwrap().arquivos,
            ..vinculo
        };
        assert!(publicar_local(&state, preparada.clone(), Some(novo.clone())).is_err());
        assert_eq!(
            std::fs::read(antiga.path.join("mods/exemplo.jar")).unwrap(),
            b"modificado localmente"
        );
        novo.substituir_alteracoes_locais = true;
        state.registrar_processo_instancia("original", 123);
        assert!(publicar_local(&state, preparada.clone(), Some(novo.clone())).is_err());
        state.remover_pid_instancia("original");
        let atualizada = publicar_local(&state, preparada, Some(novo)).unwrap();
        assert_eq!(atualizada.id, "original");
        assert_eq!(atualizada.memory, Some(4096));
        assert_eq!(
            std::fs::read(atualizada.path.join("mods/exemplo.jar")).unwrap(),
            b"atualizado"
        );
        assert_eq!(
            std::fs::read(atualizada.path.join("mods/pessoal.jar")).unwrap(),
            b"mod pessoal"
        );
        assert_eq!(
            std::fs::read(atualizada.path.join("options.txt")).unwrap(),
            b"minhas opcoes"
        );
        assert_eq!(
            std::fs::read(atualizada.path.join("saves/mundo.dat")).unwrap(),
            b"meu mundo"
        );
        assert_eq!(
            std::fs::read_dir(raiz.join(".social-backups"))
                .unwrap()
                .count(),
            1
        );
    }
}
