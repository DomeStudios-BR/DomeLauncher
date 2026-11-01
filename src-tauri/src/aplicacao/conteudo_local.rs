use super::*;
use std::io::{Seek, Write};
use std::path::Path;
use std::sync::Mutex;

static IMPORTACAO_CONTEUDO: Mutex<()> = Mutex::new(());

#[derive(Serialize, Default)]
pub(crate) struct ResultadoImportacaoConteudo {
    adicionados: Vec<String>,
    erros: Vec<String>,
}

#[tauri::command]
pub(crate) async fn importar_conteudo_local(
    instance_id: String,
    content_type: String,
    caminhos: Vec<String>,
    state: State<'_, LauncherState>,
) -> Result<ResultadoImportacaoConteudo, String> {
    if caminhos.is_empty() || caminhos.len() > 256 {
        return Err("Solte entre 1 e 256 arquivos por vez.".to_string());
    }
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let raiz = validar_caminho_dentro_raiz(&state.caminho_instancias()?, &instancia.path)?;
    tauri::async_runtime::spawn_blocking(move || importar_arquivos(&raiz, &content_type, &caminhos))
        .await
        .map_err(|erro| format!("Falha ao importar conteúdo: {erro}"))?
}

fn importar_arquivos(
    raiz: &Path,
    tipo: &str,
    caminhos: &[String],
) -> Result<ResultadoImportacaoConteudo, String> {
    let (pasta, extensao) = match tipo {
        "mods" => ("mods", "jar"),
        "resourcepacks" => ("resourcepacks", "zip"),
        "shaders" => ("shaderpacks", "zip"),
        _ => return Err("Tipo de conteúdo inválido.".to_string()),
    };
    let destino = raiz.join(pasta);
    std::fs::create_dir_all(&destino).map_err(|erro| format!("Falha ao criar pasta: {erro}"))?;
    let destino = validar_caminho_dentro_raiz(raiz, &destino)?;
    let mut resultado = ResultadoImportacaoConteudo::default();
    for caminho in caminhos {
        let origem = Path::new(caminho);
        let nome = origem
            .file_name()
            .and_then(|nome| nome.to_str())
            .unwrap_or("Arquivo");
        match copiar_conteudo(origem, &destino, extensao) {
            Ok(()) => resultado.adicionados.push(nome.to_string()),
            Err(erro) => resultado.erros.push(format!("{nome}: {erro}")),
        }
    }
    Ok(resultado)
}

fn copiar_conteudo(origem: &Path, destino: &Path, extensao: &str) -> Result<(), String> {
    let _reserva = IMPORTACAO_CONTEUDO
        .lock()
        .map_err(|erro| erro.to_string())?;
    let nome = origem
        .file_name()
        .and_then(|nome| nome.to_str())
        .ok_or("Nome de arquivo inválido.")?;
    let nome_minusculo = nome.to_lowercase();
    let nome_ativo = nome_minusculo
        .strip_suffix(".disabled")
        .unwrap_or(&nome_minusculo);
    if !origem.is_absolute() || !origem.is_file() || !nome_ativo.ends_with(&format!(".{extensao}"))
    {
        return Err(format!("Use um arquivo .{extensao} para esta aba."));
    }
    let mut entrada =
        std::fs::File::open(origem).map_err(|erro| format!("Falha ao abrir: {erro}"))?;
    zip::ZipArchive::new(&entrada).map_err(|_| "Arquivo compactado inválido.".to_string())?;
    entrada
        .rewind()
        .map_err(|erro| format!("Falha ao ler arquivo: {erro}"))?;
    let ativo = if nome_minusculo.ends_with(".disabled") {
        &nome[..nome.len() - 9]
    } else {
        nome
    };
    if destino.join(ativo).exists() || destino.join(format!("{ativo}.disabled")).exists() {
        return Err("Já existe um arquivo com esse nome na instância.".to_string());
    }
    gravar_sem_substituir(&mut entrada, &destino.join(nome))
}

fn gravar_sem_substituir(entrada: &mut impl std::io::Read, destino: &Path) -> Result<(), String> {
    let mut saida = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destino)
        .map_err(|erro| {
            format!("Não foi possível criar o arquivo sem substituir conteúdo: {erro}")
        })?;
    let resultado = (|| {
        std::io::copy(entrada, &mut saida).map_err(|erro| format!("Falha ao copiar: {erro}"))?;
        saida
            .flush()
            .map_err(|erro| format!("Falha ao concluir cópia: {erro}"))?;
        saida
            .sync_all()
            .map_err(|erro| format!("Falha ao gravar cópia: {erro}"))?;
        Ok(())
    })();
    drop(saida);
    if resultado.is_err() {
        let _ = std::fs::remove_file(destino);
    }
    resultado
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn copia_exclusiva_recusa_colisao_e_remove_arquivo_parcial() {
        struct LeituraInterrompida(bool);
        impl std::io::Read for LeituraInterrompida {
            fn read(&mut self, destino: &mut [u8]) -> std::io::Result<usize> {
                if self.0 {
                    return Err(std::io::Error::other("Leitura interrompida"));
                }
                self.0 = true;
                destino[0] = 1;
                Ok(1)
            }
        }
        let raiz = std::env::temp_dir().join(format!("dome-copia-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&raiz).unwrap();
        let destino = raiz.join("mod.jar");
        assert!(gravar_sem_substituir(&mut LeituraInterrompida(false), &destino).is_err());
        assert!(!destino.exists());
        gravar_sem_substituir(&mut &b"original"[..], &destino).unwrap();
        assert!(gravar_sem_substituir(&mut &b"substituto"[..], &destino).is_err());
        assert_eq!(std::fs::read(&destino).unwrap(), b"original");
        std::fs::remove_dir_all(raiz).unwrap();
    }

    #[test]
    fn importa_categorias_preserva_origem_e_recusa_colisoes() {
        let raiz = std::env::temp_dir().join(format!("dome-importar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&raiz).unwrap();
        for (tipo, pasta, extensao) in [
            ("mods", "mods", "jar"),
            ("resourcepacks", "resourcepacks", "zip"),
            ("shaders", "shaderpacks", "zip"),
        ] {
            let origem = raiz.join(format!("pacote.{extensao}"));
            let arquivo = std::fs::File::create(&origem).unwrap();
            zip::ZipWriter::new(arquivo).finish().unwrap();
            let bytes = std::fs::read(&origem).unwrap();
            let caminhos = vec![origem.to_string_lossy().to_string()];
            let resultado = importar_arquivos(&raiz, tipo, &caminhos).unwrap();
            assert_eq!(resultado.adicionados.len(), 1);
            assert_eq!(std::fs::read(&origem).unwrap(), bytes);
            assert_eq!(
                std::fs::read(raiz.join(pasta).join(origem.file_name().unwrap())).unwrap(),
                bytes
            );
            let resultado = importar_arquivos(&raiz, tipo, &caminhos).unwrap();
            assert_eq!(resultado.erros.len(), 1);
            assert!(resultado.adicionados.is_empty());
        }
        let invalido = raiz.join("invalido.jar");
        std::fs::write(&invalido, b"nao e zip").unwrap();
        let resultado = importar_arquivos(
            &raiz,
            "mods",
            &[
                invalido.to_string_lossy().to_string(),
                raiz.join("pacote.zip").to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        assert_eq!(resultado.erros.len(), 2);
        assert!(!raiz.join("mods/invalido.jar").exists());
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
