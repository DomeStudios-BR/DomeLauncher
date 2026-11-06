pub(super) fn fingerprint_curseforge(caminho: &std::path::Path) -> Result<u32, String> {
    let bytes =
        std::fs::read(caminho).map_err(|e| format!("Erro ao ler {}: {}", caminho.display(), e))?;
    Ok(fingerprint_bytes_curseforge(&bytes))
}

pub(super) fn fingerprint_bytes_curseforge(bytes: &[u8]) -> u32 {
    let normalizados = bytes
        .iter()
        .copied()
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
    hash
}
