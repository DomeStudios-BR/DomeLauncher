use std::collections::HashSet;
use std::path::Path;

#[derive(Default)]
pub(super) struct ModsDesativados {
    identidades: HashSet<Vec<String>>,
    nomes: HashSet<String>,
}

impl ModsDesativados {
    pub(super) fn carregar(pasta: &Path) -> Result<Self, String> {
        let mut resultado = Self::default();
        if !pasta.is_dir() {
            return Ok(resultado);
        }
        for entrada in std::fs::read_dir(pasta).map_err(|erro| erro.to_string())? {
            let entrada = entrada.map_err(|erro| erro.to_string())?;
            if entrada
                .file_type()
                .map_err(|erro| erro.to_string())?
                .is_file()
                && entrada
                    .file_name()
                    .to_string_lossy()
                    .to_lowercase()
                    .ends_with(".jar.disabled")
            {
                resultado.registrar(&entrada.path());
            }
        }
        Ok(resultado)
    }

    pub(super) fn registrar(&mut self, caminho: &Path) {
        let identidade = super::conteudo_instalado::identificadores_mod_declarados(caminho);
        if identidade.is_empty() {
            if let Some(nome) = caminho.file_name().and_then(|nome| nome.to_str()) {
                let nome = nome.to_lowercase();
                self.nomes
                    .insert(nome.strip_suffix(".disabled").unwrap_or(&nome).to_string());
            }
        } else {
            self.identidades.insert(identidade);
        }
    }

    pub(super) fn aplicar(&self, pasta: &Path) -> Result<(), String> {
        if !pasta.is_dir() {
            return Ok(());
        }
        for entrada in std::fs::read_dir(pasta).map_err(|erro| erro.to_string())? {
            let entrada = entrada.map_err(|erro| erro.to_string())?;
            let nome = entrada.file_name().to_string_lossy().to_string();
            if !entrada
                .file_type()
                .map_err(|erro| erro.to_string())?
                .is_file()
                || !nome.to_lowercase().ends_with(".jar")
            {
                continue;
            }
            let identidade =
                super::conteudo_instalado::identificadores_mod_declarados(&entrada.path());
            if self.nomes.contains(&nome.to_lowercase()) || self.identidades.contains(&identidade) {
                let destino = pasta.join(format!("{nome}.disabled"));
                if destino.exists() {
                    return Err(format!("Conflito ao preservar mod desativado: {nome}"));
                }
                std::fs::rename(entrada.path(), destino).map_err(|erro| erro.to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn preserva_mod_desativado_sem_identificacao_remota_ou_metadados() {
        let raiz = std::env::temp_dir().join(format!("dome-estado-local-{}", uuid::Uuid::new_v4()));
        let original = raiz.join("original");
        let preparada = raiz.join("preparada");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::create_dir(&preparada).unwrap();
        std::fs::write(original.join("biblioteca.jar.disabled"), b"sem metadados").unwrap();
        std::fs::write(preparada.join("biblioteca.jar"), b"dependencia nova").unwrap();
        let estado = ModsDesativados::carregar(&original).unwrap();
        estado.aplicar(&preparada).unwrap();
        assert!(!preparada.join("biblioteca.jar").exists());
        assert!(preparada.join("biblioteca.jar.disabled").exists());
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
