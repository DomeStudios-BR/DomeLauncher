use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use super::origem_crash::{identificar_origem, ModSuspeito};
use crate::comandos::instancia_sistema::{obter_instancia_por_id, validar_caminho_dentro_raiz};
use crate::launcher::LauncherState;

const LIMITE_LOG: u64 = 2 * 1024 * 1024;
pub(super) const EVENTO_DIAGNOSTICO: &str = "dome:diagnostico-crash";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticoCrash {
    pub instance_id: String,
    pub estado: &'static str,
    pub codigo_saida: Option<i32>,
    pub resumo: String,
    pub origem: Option<String>,
    pub mods: Vec<ModSuspeito>,
    pub arquivos: Vec<String>,
    pub avisos: Vec<String>,
}

impl DiagnosticoCrash {
    fn novo(id: &str, estado: &'static str, resumo: &str, codigo: Option<i32>) -> Self {
        Self {
            instance_id: id.into(),
            estado,
            codigo_saida: codigo,
            resumo: resumo.into(),
            origem: None,
            mods: Vec::new(),
            arquivos: Vec::new(),
            avisos: Vec::new(),
        }
    }
}

#[derive(Debug)]
struct RegistroSessao {
    pid: u32,
    interrompido: bool,
    diagnostico: DiagnosticoCrash,
}

#[derive(Debug, Default)]
pub(crate) struct EstadoDiagnosticos(Mutex<HashMap<String, RegistroSessao>>);

impl EstadoDiagnosticos {
    pub(crate) fn iniciar(&self, id: &str, pid: u32) -> DiagnosticoCrash {
        let diagnostico = DiagnosticoCrash::novo(id, "emExecucao", "Minecraft em execução.", None);
        if let Ok(mut registros) = self.0.lock() {
            registros.insert(
                id.into(),
                RegistroSessao {
                    pid,
                    interrompido: false,
                    diagnostico: diagnostico.clone(),
                },
            );
        }
        diagnostico
    }

    /// Registra a intenção junto da finalização para impedir que o monitor anuncie um crash durante o clique em Parar.
    pub(crate) fn encerrar_pelo_usuario(
        &self,
        id: &str,
        pid: u32,
        encerrar: impl FnOnce() -> bool,
    ) -> bool {
        let Ok(mut registros) = self.0.lock() else {
            return false;
        };
        let finalizado = encerrar();
        if let Some(registro) = registros.get_mut(id).filter(|registro| registro.pid == pid) {
            registro.interrompido |= finalizado;
        }
        finalizado
    }

    pub(super) fn concluir(
        &self,
        pid: u32,
        mut diagnostico: DiagnosticoCrash,
    ) -> Option<DiagnosticoCrash> {
        let mut registros = self.0.lock().ok()?;
        let registro = registros.get_mut(&diagnostico.instance_id)?;
        if registro.pid != pid {
            return None;
        }
        if registro.interrompido {
            diagnostico = DiagnosticoCrash::novo(
                &diagnostico.instance_id,
                "interrompido",
                "Minecraft encerrado pelo launcher.",
                diagnostico.codigo_saida,
            );
        }
        registro.diagnostico = diagnostico.clone();
        Some(diagnostico)
    }
}

#[tauri::command]
pub(crate) fn obter_diagnostico_crash(
    instance_id: String,
    state: State<LauncherState>,
    diagnosticos: State<EstadoDiagnosticos>,
) -> Result<Option<DiagnosticoCrash>, String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let registros = diagnosticos
        .0
        .lock()
        .map_err(|_| "Falha ao consultar diagnóstico.".to_string())?;
    Ok(registros
        .get(&instancia.id)
        .map(|registro| registro.diagnostico.clone()))
}

#[derive(Clone, PartialEq)]
struct MarcaArquivo {
    tamanho: u64,
    modificacao: Option<SystemTime>,
    prefixo: Vec<u8>,
    final_anterior: Vec<u8>,
}

impl MarcaArquivo {
    fn ler(caminho: &Path) -> std::io::Result<Self> {
        let mut arquivo = File::open(caminho)?;
        let metadados = arquivo.metadata()?;
        let mut prefixo = vec![0; metadados.len().min(256) as usize];
        arquivo.read_exact(&mut prefixo)?;
        arquivo.seek(SeekFrom::Start(metadados.len().saturating_sub(256)))?;
        let mut final_anterior = Vec::new();
        arquivo.take(256).read_to_end(&mut final_anterior)?;
        Ok(Self {
            tamanho: metadados.len(),
            modificacao: metadados.modified().ok(),
            prefixo,
            final_anterior,
        })
    }
}

pub(crate) struct SessaoLogs {
    caminho: PathBuf,
    anteriores: HashMap<PathBuf, MarcaArquivo>,
}

fn caminhos_logs(raiz: &Path) -> Vec<PathBuf> {
    let mut caminhos = ["latest.log", "debug.log", "dome-console.log"]
        .into_iter()
        .map(|nome| raiz.join("logs").join(nome))
        .collect::<Vec<_>>();
    for pasta in [raiz.join("crash-reports"), raiz.to_path_buf()] {
        let Ok(entradas) = std::fs::read_dir(&pasta) else {
            continue;
        };
        caminhos.extend(
            entradas
                .flatten()
                .map(|entrada| entrada.path())
                .filter(|caminho| {
                    let nome = caminho.file_name().unwrap_or_default().to_string_lossy();
                    (pasta.ends_with("crash-reports")
                        && nome.starts_with("crash-")
                        && nome.ends_with(".txt"))
                        || (nome.starts_with("hs_err_pid") && nome.ends_with(".log"))
                }),
        );
    }
    caminhos
}

impl SessaoLogs {
    /// Tire a fotografia antes de iniciar o Java para não atribuir relatórios de uma partida anterior à atual.
    pub(crate) fn preparar(caminho: &Path) -> Self {
        let caminho = caminho
            .canonicalize()
            .unwrap_or_else(|_| caminho.to_path_buf());
        let anteriores = caminhos_logs(&caminho)
            .into_iter()
            .filter(|arquivo| {
                arquivo
                    .file_name()
                    .is_none_or(|nome| nome != "dome-console.log")
            })
            .filter_map(|arquivo| validar_caminho_dentro_raiz(&caminho, &arquivo).ok())
            .filter_map(|arquivo| {
                MarcaArquivo::ler(&arquivo)
                    .ok()
                    .map(|marca| (arquivo, marca))
            })
            .collect();
        Self {
            caminho,
            anteriores,
        }
    }

    pub(crate) fn analisar(
        &self,
        id: &str,
        sucesso: Option<bool>,
        codigo: Option<i32>,
    ) -> DiagnosticoCrash {
        let mut diagnostico =
            DiagnosticoCrash::novo(id, "normal", "Minecraft encerrado normalmente.", codigo);
        let mut fontes = Vec::new();
        let mut caminhos = caminhos_logs(&self.caminho);
        caminhos.sort_by_key(|caminho| {
            std::cmp::Reverse(
                std::fs::metadata(caminho)
                    .and_then(|dados| dados.modified())
                    .ok(),
            )
        });
        let mut relatorios = 0;
        for caminho in caminhos {
            if !caminho.exists() {
                continue;
            }
            let resultado = validar_caminho_dentro_raiz(&self.caminho, &caminho)
                .and_then(|seguro| self.ler_fonte(&seguro).map_err(|erro| erro.to_string()));
            match resultado {
                Ok(Some(texto)) => {
                    let relatorio = caminho
                        .parent()
                        .is_some_and(|pasta| pasta.ends_with("crash-reports"))
                        || caminho
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .starts_with("hs_err_pid");
                    if relatorio {
                        relatorios += 1;
                        if relatorios > 4 {
                            continue;
                        }
                    }
                    let nome = caminho
                        .strip_prefix(&self.caminho)
                        .unwrap_or(&caminho)
                        .to_string_lossy()
                        .to_string();
                    diagnostico.arquivos.push(nome.clone());
                    fontes.push((nome, texto));
                }
                Err(_) => diagnostico.avisos.push(format!(
                    "Não foi possível ler {}.",
                    caminho.file_name().unwrap_or_default().to_string_lossy(),
                )),
                Ok(None) => {}
            }
        }

        let relatorio_fatal = fontes.iter().any(|(_, texto)| {
            texto.contains("---- Minecraft Crash Report ----")
                || texto.contains("A fatal error has been detected by the Java Runtime Environment")
        });
        let falha_carregamento_mods = fontes.iter().any(|(_, texto)| {
            texto.contains("---- Minecraft Crash Report ----")
                && texto.contains("Description: Mod loading")
                && texto.contains("Failure message:")
        });
        let encerramento_limpo = fontes.iter().any(|(_, texto)| {
            let parada = texto.rfind("Stopping!");
            let falha = texto
                .rfind("---- Minecraft Crash Report ----")
                .or_else(|| texto.rfind("Encountered an unexpected exception"));
            parada.is_some_and(|parada| falha.is_none_or(|falha| parada > falha))
        });
        if sucesso == Some(true)
            && !falha_carregamento_mods
            && (!relatorio_fatal || encerramento_limpo)
        {
            return diagnostico;
        }
        if sucesso.is_none() && !relatorio_fatal {
            diagnostico.estado = "indeterminado";
            diagnostico.resumo = "Não foi possível confirmar como o Minecraft encerrou.".into();
            return diagnostico;
        }

        diagnostico.estado = "crash";
        diagnostico.resumo = "A origem do crash não foi encontrada.".into();
        let origem = identificar_origem(&self.caminho, &fontes);
        diagnostico.origem = origem.descricao;
        diagnostico.mods = origem.mods;
        diagnostico.avisos.extend(origem.avisos);
        if let Some(origem) = &diagnostico.origem {
            diagnostico.resumo = format!("Origem provável do crash: {}.", origem);
        }
        diagnostico
    }

    fn ler_fonte(&self, caminho: &Path) -> std::io::Result<Option<String>> {
        let marca = MarcaArquivo::ler(caminho)?;
        let anterior = self.anteriores.get(caminho);
        if anterior == Some(&marca) {
            return Ok(None);
        }
        let inicio = anterior
            .filter(|anterior| {
                anterior.tamanho > 0
                    && marca.tamanho >= anterior.tamanho
                    && marca.prefixo.starts_with(&anterior.prefixo)
                    && self.preserva_final_anterior(caminho, anterior)
            })
            .map_or(0, |anterior| anterior.tamanho);
        let inicio = inicio.max(marca.tamanho.saturating_sub(LIMITE_LOG));
        let mut arquivo = File::open(caminho)?;
        arquivo.seek(SeekFrom::Start(inicio))?;
        let mut bytes = Vec::new();
        arquivo.take(LIMITE_LOG).read_to_end(&mut bytes)?;
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    }

    fn preserva_final_anterior(&self, caminho: &Path, anterior: &MarcaArquivo) -> bool {
        let Ok(mut arquivo) = File::open(caminho) else {
            return false;
        };
        if arquivo
            .seek(SeekFrom::Start(anterior.tamanho.saturating_sub(256)))
            .is_err()
        {
            return false;
        }
        let mut trecho = vec![0; anterior.final_anterior.len()];
        arquivo.read_exact(&mut trecho).is_ok() && trecho == anterior.final_anterior
    }
}

pub(crate) fn publicar_diagnostico(
    app: &tauri::AppHandle,
    pid: u32,
    diagnostico: DiagnosticoCrash,
) {
    if let Some(resultado) = app.state::<EstadoDiagnosticos>().concluir(pid, diagnostico) {
        let _ = app.emit(EVENTO_DIAGNOSTICO, resultado);
    }
}

#[cfg(test)]
#[path = "testes_diagnostico_crash.rs"]
mod testes;
