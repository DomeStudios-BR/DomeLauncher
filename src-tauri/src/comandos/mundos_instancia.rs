use super::instancia_sistema::WorldInfo;
use super::progresso_operacao::Acompanhamento;
use std::path::Path;

fn tamanho_diretorio(pasta: &Path) -> Result<u64, String> {
    let mut bytes = 0u64;
    for entrada in
        std::fs::read_dir(pasta).map_err(|e| format!("Não foi possível ler o mundo: {e}"))?
    {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let tipo = entrada.file_type().map_err(|e| e.to_string())?;
        if tipo.is_symlink() {
            continue;
        }
        let tamanho = if tipo.is_dir() {
            tamanho_diretorio(&entrada.path())?
        } else if tipo.is_file() {
            entrada.metadata().map_err(|e| e.to_string())?.len()
        } else {
            0
        };
        bytes = bytes
            .checked_add(tamanho)
            .ok_or("O tamanho do mundo excede o limite suportado.")?;
    }
    Ok(bytes)
}

fn formatar_tamanho(bytes: u64) -> String {
    let mut tamanho = bytes as f64;
    let unidades = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut unidade = 0;
    while tamanho >= 1024.0 && unidade < unidades.len() - 1 {
        tamanho /= 1024.0;
        unidade += 1;
    }
    if unidade == 0 {
        format!("{bytes} B")
    } else {
        format!("{tamanho:.2} {}", unidades[unidade]).replace('.', ",")
    }
}

pub(crate) fn listar_mundos(
    pasta: &Path,
    progresso: &Acompanhamento,
) -> Result<Vec<WorldInfo>, String> {
    if !pasta.exists() {
        progresso.concluir("Mundos carregados");
        return Ok(Vec::new());
    }
    let mut pastas = Vec::new();
    for entrada in std::fs::read_dir(pasta).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        if entrada.file_type().map_err(|e| e.to_string())?.is_dir()
            && entrada.path().join("level.dat").is_file()
        {
            pastas.push(entrada.path());
        }
    }
    let total = pastas.len() as u64;
    let mut mundos = Vec::new();
    for (indice, caminho) in pastas.into_iter().enumerate() {
        let bytes = tamanho_diretorio(&caminho)?;
        mundos.push(WorldInfo {
            name: caminho
                .file_name()
                .and_then(|nome| nome.to_str())
                .unwrap_or("Mundo desconhecido")
                .into(),
            path: caminho.to_string_lossy().into(),
            game_mode: "Survival".into(),
            difficulty: "Normal".into(),
            last_played: "Recentemente".into(),
            size_on_disk: formatar_tamanho(bytes),
            size_bytes: bytes,
        });
        progresso.informar("Lendo mundos", indice as u64 + 1, total);
    }
    progresso.concluir("Mundos carregados");
    Ok(mundos)
}

#[cfg(test)]
mod testes {
    use super::*;
    #[test]
    fn soma_regioes_dimensoes_e_metadados_sem_tamanho_fixo() {
        let raiz = std::env::temp_dir().join(format!("dome-mundos-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(raiz.join("Mundo/DIM-1/region")).unwrap();
        let _limpeza = crate::comandos::social_launcher::pacotes_sociais::PastaTemporaria::nova(
            raiz.parent().unwrap(),
            &raiz,
        )
        .unwrap();
        std::fs::write(raiz.join("Mundo/level.dat"), [0u8; 17]).unwrap();
        std::fs::write(raiz.join("Mundo/DIM-1/region/r.0.0.mca"), [0u8; 4096]).unwrap();
        let mundos = listar_mundos(&raiz, &Acompanhamento::default()).unwrap();
        assert_eq!(mundos.len(), 1);
        assert_eq!(mundos[0].size_bytes, 4113);
        assert_eq!(mundos[0].size_on_disk, "4,02 KiB");
        assert_eq!(formatar_tamanho(1_048_576), "1,00 MiB");
    }
}
