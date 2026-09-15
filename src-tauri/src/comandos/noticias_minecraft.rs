use futures::{stream, StreamExt};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

const MINECRAFT_SITEMAP_URL: &str = "https://www.minecraft.net/sitemap.xml";
const MINECRAFT_SITE_BASE_URL: &str = "https://www.minecraft.net";
const ESPELHO_NOTICIAS_URL: &str = "https://mcbe.news/news/official/rss.xml";
const USER_AGENT_NAVEGADOR: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";
const CACHE_NOTICIAS_TTL_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoticiaMinecraft {
    pub titulo: String,
    pub descricao: String,
    pub url: String,
    pub imagem_url: Option<String>,
    pub publicado_em: String,
    #[serde(default)]
    pub espelho_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BlocoNoticiaMinecraft {
    pub tipo: String,
    pub texto: Option<String>,
    pub url: Option<String>,
    pub descricao: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConteudoNoticiaMinecraft {
    pub autor: Option<String>,
    pub blocos: Vec<BlocoNoticiaMinecraft>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheNoticiasMinecraft {
    pub gerado_em_ms: u64,
    pub itens: Vec<NoticiaMinecraft>,
}

fn agora_em_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duracao| duracao.as_millis() as u64)
        .unwrap_or(0)
}

fn get_cache_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(|app_data| {
            std::path::PathBuf::from(app_data)
                .join("dome")
                .join("cache")
        })
        .unwrap_or_else(|_| std::path::PathBuf::from("cache"))
}

fn get_minecraft_news_cache_path() -> std::path::PathBuf {
    get_cache_dir().join("minecraft-news-v3.json")
}

fn ler_cache_noticias_minecraft(limite: usize) -> Option<Vec<NoticiaMinecraft>> {
    let caminho = get_minecraft_news_cache_path();
    let conteudo = std::fs::read_to_string(caminho).ok()?;
    let cache = serde_json::from_str::<CacheNoticiasMinecraft>(&conteudo).ok()?;
    let idade = agora_em_ms().saturating_sub(cache.gerado_em_ms);

    if idade > CACHE_NOTICIAS_TTL_MS {
        return None;
    }

    if cache.itens.is_empty() {
        return None;
    }

    Some(cache.itens.into_iter().take(limite).collect())
}

fn salvar_cache_noticias_minecraft(itens: &[NoticiaMinecraft]) {
    if itens.is_empty() {
        return;
    }

    let caminho = get_minecraft_news_cache_path();
    if let Some(pasta) = caminho.parent() {
        let _ = std::fs::create_dir_all(pasta);
    }

    let cache = CacheNoticiasMinecraft {
        gerado_em_ms: agora_em_ms(),
        itens: itens.to_vec(),
    };

    if let Ok(conteudo) = serde_json::to_string(&cache) {
        let _ = std::fs::write(caminho, conteudo);
    }
}

fn decodificar_entidades(texto: &str) -> String {
    texto
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn limpar_texto_html(texto: &str) -> String {
    decodificar_entidades(texto)
        .replace(['\n', '\r'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extrair_tag_xml(bloco: &str, tag: &str) -> Option<String> {
    let inicio_tag = format!("<{}>", tag);
    let fim_tag = format!("</{}>", tag);

    let inicio = bloco.find(&inicio_tag)? + inicio_tag.len();
    let resto = &bloco[inicio..];
    let fim_rel = resto.find(&fim_tag)?;
    let valor = resto[..fim_rel]
        .trim()
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .trim();

    if valor.is_empty() {
        None
    } else {
        Some(decodificar_entidades(valor))
    }
}

fn extrair_atributo_html(tag: &str, nome: &str) -> Option<String> {
    let padrao_aspas_duplas = format!(r#"{}=""#, nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_duplas) {
        let inicio_valor = inicio_idx + padrao_aspas_duplas.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('"')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    let padrao_aspas_simples = format!("{}='", nome);
    if let Some(inicio_idx) = tag.find(&padrao_aspas_simples) {
        let inicio_valor = inicio_idx + padrao_aspas_simples.len();
        let restante = &tag[inicio_valor..];
        let fim = restante.find('\'')?;
        let valor = restante[..fim].trim();
        if !valor.is_empty() {
            return Some(decodificar_entidades(valor));
        }
    }

    None
}

fn extrair_meta_content(html: &str, atributo: &str, valor: &str) -> Option<String> {
    let marcador_aspas_duplas = format!(r#"{}="{}""#, atributo, valor);
    let marcador_aspas_simples = format!("{}='{}'", atributo, valor);

    for trecho in html.split("<meta").skip(1) {
        let tag = match trecho.split('>').next() {
            Some(valor_tag) => valor_tag,
            None => continue,
        };

        if !tag.contains(&marcador_aspas_duplas) && !tag.contains(&marcador_aspas_simples) {
            continue;
        }

        if let Some(conteudo) = extrair_atributo_html(tag, "content") {
            let limpo = limpar_texto_html(&conteudo);
            if !limpo.is_empty() {
                return Some(limpo);
            }
        }
    }

    None
}

fn extrair_primeiro_meta(html: &str, seletores: &[(&str, &str)]) -> Option<String> {
    for (atributo, valor) in seletores {
        if let Some(conteudo) = extrair_meta_content(html, atributo, valor) {
            if !conteudo.trim().is_empty() {
                return Some(conteudo);
            }
        }
    }
    None
}

fn extrair_titulo_html(html: &str) -> Option<String> {
    let inicio = html.find("<title>")? + "<title>".len();
    let restante = &html[inicio..];
    let fim = restante.find("</title>")?;
    let titulo_bruto = restante[..fim].trim();
    if titulo_bruto.is_empty() {
        return None;
    }

    let titulo_limpo = limpar_texto_html(titulo_bruto)
        .replace(" | Minecraft", "")
        .trim()
        .to_string();
    if titulo_limpo.is_empty() {
        None
    } else {
        Some(titulo_limpo)
    }
}

fn titulo_da_url_artigo(url: &str) -> String {
    let slug = url
        .split("/article/")
        .nth(1)
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_matches('/');

    if slug.is_empty() {
        return "Notícia do Minecraft".to_string();
    }

    slug.split('-')
        .filter(|parte| !parte.trim().is_empty())
        .map(|parte| {
            let mut caracteres = parte.chars();
            match caracteres.next() {
                Some(inicial) => {
                    format!("{}{}", inicial.to_uppercase(), caracteres.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalizar_url_minecraft(url: &str) -> String {
    let valor = url.trim();
    if valor.starts_with("https://") || valor.starts_with("http://") {
        return valor.to_string();
    }
    if valor.starts_with("//") {
        return format!("https:{}", valor);
    }
    if valor.starts_with('/') {
        return format!("{}{}", MINECRAFT_SITE_BASE_URL, valor);
    }
    format!("{}/{}", MINECRAFT_SITE_BASE_URL, valor)
}

fn validar_url_artigo_minecraft(valor: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(valor).map_err(|_| "URL da notícia inválida.".to_string())?;
    let dominio_valido = matches!(
        url.host_str(),
        Some("www.minecraft.net") | Some("minecraft.net")
    );

    if url.scheme() != "https" || !dominio_valido || !url.path().contains("/article/") {
        return Err("A notícia precisa pertencer ao site oficial do Minecraft.".to_string());
    }

    Ok(url)
}

fn normalizar_url_imagem_minecraft(valor: &str) -> Option<String> {
    let url_normalizada = normalizar_url_minecraft(valor);
    let url = url::Url::parse(&url_normalizada).ok()?;
    let dominio_valido = matches!(
        url.host_str(),
        Some("www.minecraft.net") | Some("minecraft.net")
    );

    if url.scheme() == "https" && dominio_valido {
        Some(url.to_string())
    } else {
        None
    }
}

fn texto_elemento(elemento: scraper::ElementRef<'_>) -> String {
    elemento
        .text()
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ")
}

fn extrair_conteudo_artigo(html: &str) -> ConteudoNoticiaMinecraft {
    let documento = Html::parse_document(html);
    let seletor_autor = Selector::parse(".MC_articleHeroA_attribution_author dd").unwrap();
    let seletor_blocos = Selector::parse(".article-text, .article-media").unwrap();
    let seletor_textos = Selector::parse("h1, h2, h3, p, li").unwrap();
    let seletor_imagens = Selector::parse("img").unwrap();
    let autor = documento
        .select(&seletor_autor)
        .next()
        .map(texto_elemento)
        .filter(|texto| !texto.is_empty());
    let mut blocos = Vec::new();

    for elemento in documento.select(&seletor_blocos) {
        let classes = elemento.value().attr("class").unwrap_or_default();

        if classes
            .split_whitespace()
            .any(|classe| classe == "article-text")
        {
            for trecho in elemento.select(&seletor_textos) {
                let texto = texto_elemento(trecho);
                if texto.is_empty() {
                    continue;
                }

                let tipo = match trecho.value().name() {
                    "h1" | "h2" | "h3" => "titulo",
                    _ => "paragrafo",
                };
                blocos.push(BlocoNoticiaMinecraft {
                    tipo: tipo.to_string(),
                    texto: Some(texto),
                    url: None,
                    descricao: None,
                });
            }
        } else if let Some(imagem) = elemento.select(&seletor_imagens).next() {
            if let Some(src) = imagem.value().attr("src") {
                if let Some(url) = normalizar_url_imagem_minecraft(src) {
                    blocos.push(BlocoNoticiaMinecraft {
                        tipo: "imagem".to_string(),
                        texto: None,
                        url: Some(url),
                        descricao: imagem
                            .value()
                            .attr("alt")
                            .map(limpar_texto_html)
                            .filter(|texto| !texto.is_empty()),
                    });
                }
            }
        }

        if blocos.len() >= 80 {
            break;
        }
    }

    ConteudoNoticiaMinecraft { autor, blocos }
}

fn extrair_url_imagem_espelho(elemento: scraper::ElementRef<'_>) -> Option<String> {
    for atributo in ["src", "srcset"] {
        let valor = elemento.value().attr(atributo)?;
        for candidato in valor
            .split(',')
            .map(|item| item.split_whitespace().next().unwrap_or(""))
        {
            if let Some(url) = normalizar_url_imagem_minecraft(candidato) {
                return Some(url);
            }

            let url_espelho = url::Url::parse(&format!("https://mcbe.news{}", candidato)).ok()?;
            let original = url_espelho
                .query_pairs()
                .find_map(|(chave, valor)| (chave == "url").then(|| valor.into_owned()));
            if let Some(url) = original.and_then(|url| normalizar_url_imagem_minecraft(&url)) {
                return Some(url);
            }
        }
    }
    None
}

fn extrair_conteudo_espelho(html: &str) -> ConteudoNoticiaMinecraft {
    let documento = Html::parse_document(html);
    let seletor_conteudo = Selector::parse(".mc-rich-content h1, .mc-rich-content h2, .mc-rich-content h3, .mc-rich-content p, .mc-rich-content img").unwrap();
    let autor = extrair_primeiro_meta(html, &[("property", "article:author")]);
    let mut blocos = Vec::new();

    for elemento in documento.select(&seletor_conteudo).take(80) {
        if elemento.value().name() == "img" {
            if let Some(url) = extrair_url_imagem_espelho(elemento) {
                blocos.push(BlocoNoticiaMinecraft {
                    tipo: "imagem".to_string(),
                    texto: None,
                    url: Some(url),
                    descricao: elemento
                        .value()
                        .attr("alt")
                        .map(limpar_texto_html)
                        .filter(|texto| !texto.is_empty()),
                });
            }
            continue;
        }

        let texto = texto_elemento(elemento);
        if texto.is_empty() {
            continue;
        }
        let tipo = if matches!(elemento.value().name(), "h1" | "h2" | "h3") {
            "titulo"
        } else {
            "paragrafo"
        };
        blocos.push(BlocoNoticiaMinecraft {
            tipo: tipo.to_string(),
            texto: Some(texto),
            url: None,
            descricao: None,
        });
    }

    ConteudoNoticiaMinecraft { autor, blocos }
}

async fn baixar_noticias_do_espelho(
    client: &reqwest::Client,
    limite: usize,
) -> Result<Vec<NoticiaMinecraft>, String> {
    let rss = client
        .get(ESPELHO_NOTICIAS_URL)
        .send()
        .await
        .map_err(|erro| format!("Não foi possível consultar o espelho de notícias: {}", erro))?
        .error_for_status()
        .map_err(|erro| format!("O espelho de notícias retornou um erro: {}", erro))?
        .text()
        .await
        .map_err(|erro| format!("Não foi possível ler o espelho de notícias: {}", erro))?;
    let mut noticias = Vec::new();

    for trecho in rss.split("<item>").skip(1).take(limite) {
        let item = trecho.split("</item>").next().unwrap_or_default();
        let Some(titulo) = extrair_tag_xml(item, "title") else {
            continue;
        };
        let Some(url) = item
            .split("<source")
            .nth(1)
            .and_then(|fonte| fonte.split('>').next())
            .and_then(|tag| extrair_atributo_html(tag, "url"))
        else {
            continue;
        };
        if validar_url_artigo_minecraft(&url).is_err() {
            continue;
        }

        let imagem_url = item
            .split("<media:thumbnail")
            .nth(1)
            .and_then(|imagem| imagem.split('>').next())
            .and_then(|tag| extrair_atributo_html(tag, "url"))
            .and_then(|url| normalizar_url_imagem_minecraft(&url));
        noticias.push(NoticiaMinecraft {
            titulo: limpar_texto_html(&titulo),
            descricao: extrair_tag_xml(item, "description")
                .map(|texto| limpar_texto_html(&texto))
                .unwrap_or_default(),
            url,
            imagem_url,
            publicado_em: extrair_tag_xml(item, "pubDate").unwrap_or_default(),
            espelho_url: extrair_tag_xml(item, "link"),
        });
    }

    if noticias.is_empty() {
        return Err("O espelho não retornou notícias oficiais válidas.".to_string());
    }
    Ok(noticias)
}

async fn montar_noticia_minecraft(
    client: &reqwest::Client,
    url: String,
    publicado_em_sitemap: String,
) -> NoticiaMinecraft {
    let mut titulo = titulo_da_url_artigo(&url);
    let mut descricao = String::new();
    let mut imagem_url: Option<String> = None;
    let mut publicado_em = publicado_em_sitemap;

    if let Ok(resposta) = client
        .get(&url)
        .header("User-Agent", USER_AGENT_NAVEGADOR)
        .header("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
    {
        if resposta.status().is_success() {
            if let Ok(html) = resposta.text().await {
                if let Some(titulo_og) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:title"), ("name", "twitter:title")],
                ) {
                    titulo = titulo_og;
                } else if let Some(titulo_tag) = extrair_titulo_html(&html) {
                    titulo = titulo_tag;
                }

                if let Some(descricao_og) = extrair_primeiro_meta(
                    &html,
                    &[
                        ("property", "og:description"),
                        ("name", "description"),
                        ("name", "twitter:description"),
                    ],
                ) {
                    descricao = descricao_og;
                }

                if let Some(imagem) = extrair_primeiro_meta(
                    &html,
                    &[("property", "og:image"), ("name", "twitter:image")],
                ) {
                    imagem_url = normalizar_url_imagem_minecraft(&imagem);
                }

                if let Some(data_publicada) = extrair_primeiro_meta(
                    &html,
                    &[("property", "article:published_time"), ("name", "date")],
                ) {
                    publicado_em = data_publicada;
                }
            }
        }
    }

    NoticiaMinecraft {
        titulo,
        descricao,
        url,
        imagem_url,
        publicado_em,
        espelho_url: None,
    }
}

async fn baixar_sitemap_minecraft(client: &reqwest::Client) -> Result<String, String> {
    let urls = [
        MINECRAFT_SITEMAP_URL,
        "https://www.minecraft.net/en-us/sitemap.xml",
    ];
    let mut erros: Vec<String> = Vec::new();

    for url in urls {
        match client.get(url).send().await {
            Ok(resposta) => {
                if !resposta.status().is_success() {
                    erros.push(format!(
                        "{} retornou HTTP {}",
                        url,
                        resposta.status().as_u16()
                    ));
                    continue;
                }

                match resposta.text().await {
                    Ok(conteudo) => return Ok(conteudo),
                    Err(erro) => {
                        erros.push(format!("{} falhou ao ler body: {}", url, erro));
                        continue;
                    }
                }
            }
            Err(erro) => {
                erros.push(format!("{} falhou: {}", url, erro));
                continue;
            }
        }
    }

    Err(format!(
        "Erro ao buscar sitemap do Minecraft: {}",
        erros.join(" | ")
    ))
}

#[tauri::command]
pub async fn get_minecraft_news(limit: Option<u32>) -> Result<Vec<NoticiaMinecraft>, String> {
    let limite = limit.unwrap_or(5).clamp(1, 10) as usize;

    if let Some(cache) = ler_cache_noticias_minecraft(limite) {
        return Ok(cache);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .http1_only()
        .user_agent(USER_AGENT_NAVEGADOR)
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let sitemap = match baixar_sitemap_minecraft(&client).await {
        Ok(sitemap) => sitemap,
        Err(_) => {
            let noticias = baixar_noticias_do_espelho(&client, limite).await?;
            salvar_cache_noticias_minecraft(&noticias);
            return Ok(noticias);
        }
    };

    let mut artigos: Vec<(String, String)> = Vec::new();

    for trecho in sitemap.split("<url>").skip(1) {
        let bloco = match trecho.split("</url>").next() {
            Some(valor_bloco) => valor_bloco,
            None => continue,
        };

        let loc = match extrair_tag_xml(bloco, "loc") {
            Some(valor) => valor,
            None => continue,
        };

        if !loc.contains("/en-us/article/") {
            continue;
        }

        let lastmod = extrair_tag_xml(bloco, "lastmod").unwrap_or_default();
        if lastmod.is_empty() {
            continue;
        }

        artigos.push((loc, lastmod));
    }

    if artigos.is_empty() {
        return Err("Nenhuma notícia encontrada no sitemap do Minecraft.".to_string());
    }

    artigos.sort_by(|a, b| b.1.cmp(&a.1));
    let candidatos: Vec<(String, String)> = artigos.into_iter().take(limite * 3).collect();

    let mut noticias: Vec<NoticiaMinecraft> = stream::iter(candidatos)
        .map(|(url, data)| {
            let client = client.clone();
            async move { montar_noticia_minecraft(&client, url, data).await }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    noticias.sort_by(|a, b| b.publicado_em.cmp(&a.publicado_em));
    noticias.truncate(limite);

    if noticias.is_empty() {
        return Err("Nenhuma notícia pôde ser carregada no momento.".to_string());
    }

    salvar_cache_noticias_minecraft(&noticias);

    Ok(noticias)
}

#[tauri::command]
pub async fn get_minecraft_article(url: String) -> Result<ConteudoNoticiaMinecraft, String> {
    let url_validada = validar_url_artigo_minecraft(&url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .http1_only()
        .user_agent(USER_AGENT_NAVEGADOR)
        .build()
        .map_err(|erro| format!("Erro ao preparar a leitura da notícia: {}", erro))?;
    let espelho_url = ler_cache_noticias_minecraft(10)
        .and_then(|noticias| noticias.into_iter().find(|noticia| noticia.url == url))
        .and_then(|noticia| noticia.espelho_url);

    if let Some(espelho_url) = espelho_url {
        let html = client
            .get(&espelho_url)
            .send()
            .await
            .map_err(|erro| format!("Não foi possível carregar a notícia: {}", erro))?
            .error_for_status()
            .map_err(|erro| format!("O espelho da notícia retornou um erro: {}", erro))?
            .text()
            .await
            .map_err(|erro| format!("Não foi possível ler a notícia: {}", erro))?;
        let conteudo = extrair_conteudo_espelho(&html);
        if !conteudo.blocos.is_empty() {
            return Ok(conteudo);
        }
    }

    let resposta = client
        .get(url_validada)
        .header("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
        .map_err(|erro| format!("Não foi possível carregar a notícia: {}", erro))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "O Minecraft.net retornou HTTP {} ao carregar a notícia.",
            resposta.status().as_u16()
        ));
    }

    let html = resposta
        .text()
        .await
        .map_err(|erro| format!("Não foi possível ler a notícia: {}", erro))?;
    let conteudo = extrair_conteudo_artigo(&html);

    if conteudo.blocos.is_empty() {
        return Err(
            "A notícia não possui conteúdo compatível para leitura no launcher.".to_string(),
        );
    }

    Ok(conteudo)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn aceita_apenas_artigos_oficiais_https() {
        assert!(
            validar_url_artigo_minecraft("https://www.minecraft.net/pt-br/article/exemplo").is_ok()
        );
        assert!(validar_url_artigo_minecraft("https://example.com/pt-br/article/exemplo").is_err());
        assert!(
            validar_url_artigo_minecraft("http://www.minecraft.net/pt-br/article/exemplo").is_err()
        );
    }

    #[test]
    fn aceita_apenas_imagens_oficiais_https() {
        assert!(normalizar_url_imagem_minecraft("/content/dam/imagem.jpg").is_some());
        assert!(normalizar_url_imagem_minecraft("https://minecraft.net/imagem.jpg").is_some());
        assert!(normalizar_url_imagem_minecraft("https://exemplo.com/imagem.jpg").is_none());
        assert!(normalizar_url_imagem_minecraft("http://www.minecraft.net/imagem.jpg").is_none());
    }

    #[test]
    fn extrai_texto_e_imagem_em_ordem() {
        let html = r#"
            <div class="MC_articleHeroA_attribution_author"><dd>Alex</dd></div>
            <div class="article-text"><h2>Novidade</h2><p>Um novo mundo.</p></div>
            <div class="article-media"><img src="/imagem.png" alt="Paisagem"></div>
        "#;
        let conteudo = extrair_conteudo_artigo(html);

        assert_eq!(conteudo.autor.as_deref(), Some("Alex"));
        assert_eq!(conteudo.blocos.len(), 3);
        assert_eq!(conteudo.blocos[0].tipo, "titulo");
        assert_eq!(
            conteudo.blocos[2].url.as_deref(),
            Some("https://www.minecraft.net/imagem.png")
        );
    }
}
