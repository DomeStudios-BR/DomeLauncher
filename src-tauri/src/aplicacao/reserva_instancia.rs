use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

static ALTERACOES: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub(crate) struct ReservaInstancia(PathBuf);

impl ReservaInstancia {
    /// Reserve antes de preparar uma migração ou troca de modpack e mantenha até concluir a publicação.
    pub(crate) fn nova(raiz: &Path, instancia: &Path) -> Result<Self, String> {
        let caminho = super::validar_caminho_dentro_raiz(raiz, instancia)?;
        let mut alteracoes = ALTERACOES.lock().map_err(|erro| erro.to_string())?;
        if !alteracoes.insert(caminho.clone()) {
            return Err("Esta instância já está sendo alterada.".into());
        }
        Ok(Self(caminho))
    }
}

impl Drop for ReservaInstancia {
    fn drop(&mut self) {
        if let Ok(mut alteracoes) = ALTERACOES.lock() {
            alteracoes.remove(&self.0);
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn reserva_caminho_normalizado_entre_operacoes_e_libera_apos_erro() {
        let raiz = std::env::temp_dir().join(format!("dome-reserva-{}", uuid::Uuid::new_v4()));
        let instancia = raiz.join("instancia");
        let outra = raiz.join("outra");
        std::fs::create_dir_all(&instancia).unwrap();
        std::fs::create_dir_all(&outra).unwrap();
        let reserva = ReservaInstancia::nova(&raiz, &instancia).unwrap();
        assert!(ReservaInstancia::nova(&raiz, &instancia.join(".")).is_err());
        assert!(ReservaInstancia::nova(&raiz, &outra).is_ok());
        drop(reserva);
        assert!(ReservaInstancia::nova(&raiz, &instancia).is_ok());
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
