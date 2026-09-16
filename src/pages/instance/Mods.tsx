import React, { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { invoke } from '@tauri-apps/api/core'
import type { GameInstance, ContextMenuTypeOrNull, Version, ProjectListEntry } from '../../types'

interface ModsProps {
  instance: GameInstance
  options: ContextMenuTypeOrNull
  offline: boolean
  playing: boolean
  versions: Version[]
  installed: boolean
}

const Mods: React.FC<ModsProps> = ({ instance }) => {
  const TAMANHO_PAGINA = 12
  const [projects, setProjects] = useState<ProjectListEntry[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ProjectListEntry[]>([])
  const [activePlatform, setActivePlatform] = useState('modrinth')
  const [searchTimeout, setSearchTimeout] = useState<number | null>(null)
  const [paginaAtual, setPaginaAtual] = useState(1)

  const mapearArquivosInstalados = (arquivos: string[]): ProjectListEntry[] =>
    arquivos.map((fileName, index) => ({
      path: `mods/${fileName}`,
      name: fileName.replace(/\.jar(\.disabled)?$/i, '').replace(/[_-]/g, ' '),
      slug: fileName.replace('.jar', ''),
      author: { name: 'Desconhecido', slug: 'unknown', type: 'user' },
      version: 'Desconhecida',
      file_name: fileName,
      icon: undefined,
      disabled: fileName.endsWith('.disabled'),
      outdated: false,
      updated: dayjs(),
      project_type: 'mod',
      id: `installed-${index}`
    }))

  const recarregarModsInstalados = async () => {
    const installedMods: string[] = await invoke('get_installed_mods', {
      instanceId: instance.id
    })
    setProjects(mapearArquivosInstalados(installedMods))
  }

  // Carregar mods instalados e populares
  useEffect(() => {
    const loadMods = async () => {
      setLoading(true)
      try {
        const installedMods: string[] = await invoke('get_installed_mods', { instanceId: instance.id })
        const mods = mapearArquivosInstalados(installedMods)

        setProjects(mods)

        // Se não há busca ativa e não há mods instalados, mostrar mods populares
        if (!searchFilter.trim() && mods.length === 0) {
          await loadPopularMods()
        }
      } catch (error) {
        console.error('Erro ao carregar mods:', error)
        setProjects([])
      } finally {
        setLoading(false)
      }
    }

    loadMods()
  }, [instance.id])

  // Carregar mods populares
  const loadPopularMods = async () => {
    try {
      setSearching(true)
      const plataformaAtiva = activePlatform === 'curseforge' ? 'curseforge' : 'modrinth'
      const results: any[] = await invoke('search_mods_online', {
        query: '',
        platform: plataformaAtiva,
        contentType: 'mod',
        filtros: null
      })

      const formattedResults: ProjectListEntry[] = results.slice(0, 20).map(result => ({
        path: '',
        name: result.name || 'Nome desconhecido',
        slug: result.slug || (result.name ? result.name.toLowerCase().replace(/\s+/g, '-') : 'unknown'),
        author: {
          name: result.author || 'Desconhecido',
          slug: ((result.author || 'unknown').toLowerCase()),
          type: 'user'
        },
        version: result.latestVersion || 'Latest',
        file_name: '',
        icon: result.iconUrl,
        disabled: false,
        outdated: false,
        updated: dayjs(),
        project_type: 'mod',
        id: result.id
      }))

      setSearchResults(formattedResults)
    } catch (error) {
      console.error('Erro ao carregar mods populares:', error)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // Busca automática com debounce
  useEffect(() => {
    if (searchTimeout) {
      window.clearTimeout(searchTimeout)
    }

    if (searchFilter.trim()) {
      const timeout = window.setTimeout(() => {
        searchMods(searchFilter)
      }, 500) // 500ms de debounce

      setSearchTimeout(timeout)
    } else {
      // Quando não há busca, mostrar mods populares se não há mods instalados
      if (projects.length === 0) {
        loadPopularMods()
      } else {
        setSearchResults([])
      }
    }

    return () => {
      if (searchTimeout) {
        window.clearTimeout(searchTimeout)
      }
    }
  }, [searchFilter, activePlatform, projects.length])

  const searchMods = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      // Converter plataforma para o enum correto
      let platformParam = undefined
      if (activePlatform === 'modrinth') {
        platformParam = 'modrinth'
      } else if (activePlatform === 'curseforge') {
        platformParam = 'curseforge'
      }

      console.log('Buscando mods:', { query, platform: platformParam, activePlatform })

      const results: any[] = await invoke('search_mods_online', {
        query,
        platform: platformParam,
        contentType: 'mod',
        filtros: null
      })

      console.log('Resultados recebidos:', results.length, results)

      // Converter resultados da API para ProjectListEntry
      const formattedResults: ProjectListEntry[] = results.map(result => {
        console.log('Processando resultado:', result)
        return {
          path: '',
          name: result.name || 'Nome desconhecido',
          slug: result.slug || (result.name ? result.name.toLowerCase().replace(/\s+/g, '-') : 'unknown'),
          author: { name: result.author || 'Desconhecido', slug: ((result.author || 'unknown').toLowerCase()), type: 'user' },
          version: result.latestVersion || 'Latest',
          file_name: '',
          icon: result.iconUrl,
          disabled: false,
          outdated: false,
          updated: dayjs(),
          project_type: 'mod',
          id: result.id
        }
      })

      console.log('Resultados formatados:', formattedResults.length)
      setSearchResults(formattedResults)
    } catch (error) {
      console.error('Erro ao buscar mods:', error)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const installMod = async (mod: ProjectListEntry) => {
    try {
      let downloadUrl = ''
      let fileName = mod.file_name || ''
      let versionId: string | undefined

      if (activePlatform === 'modrinth') {
        const gameVersion = instance.version || instance.game_version
        if (!gameVersion) {
          alert('A instância não possui versão do Minecraft definida.')
          return
        }

        const loaderAtual = (instance.loader_type || instance.loader || '').toLowerCase()
        const loadersSuportados = ['fabric', 'forge', 'quilt', 'neoforge']
        const params = new URLSearchParams()
        params.set('game_versions', JSON.stringify([gameVersion]))
        if (loadersSuportados.includes(loaderAtual)) {
          params.set('loaders', JSON.stringify([loaderAtual]))
        }

        const versionsRes = await fetch(
          `https://api.modrinth.com/v2/project/${mod.id}/version?${params.toString()}`
        )
        const versions = await versionsRes.json()

        if (!Array.isArray(versions) || versions.length === 0) {
          alert(`Nenhuma versão compatível com ${loaderAtual || 'loader atual'} ${gameVersion}`)
          return
        }

        const version = versions[0]
        const file = version.files?.find((f: any) => f.primary) || version.files?.[0]

        if (!file?.url) {
          alert('Arquivo compatível não encontrado no Modrinth.')
          return
        }

        downloadUrl = file.url
        fileName = file.filename || fileName
        versionId = version.id
      }

      await invoke('install_mod', {
        instanceId: instance.id,
        modInfo: {
          id: mod.id,
          name: mod.name,
          description: '',
          author: mod.author?.name || 'Desconhecido',
          version: mod.version,
          download_url: downloadUrl,
          file_name: fileName,
          platform: activePlatform === 'modrinth' ? 'modrinth' : 'curseforge',
          dependencies: [],
          version_id: versionId
        }
      })

      await recarregarModsInstalados()
      setSearchResults([])
    } catch (error) {
      console.error('Erro ao instalar mod:', error)
      alert(`Erro ao instalar o mod: ${error}`)
    }
  }


  const filterOptions = [
    { id: 'updates', formattedName: 'Updates available' },
    { id: 'disabled', formattedName: 'Disabled projects' }
  ]

  const filteredProjects = projects.filter(project => {
    const updatesFilter = selectedFilters.includes('updates')
    const disabledFilter = selectedFilters.includes('disabled')
    const typeFilters = selectedFilters.filter(
      filter => filter !== 'updates' && filter !== 'disabled'
    )

    return (
      (typeFilters.length === 0 || typeFilters.includes(project.project_type)) &&
      (!updatesFilter || project.outdated) &&
      (!disabledFilter || project.disabled)
    )
  })


  const toggleArray = (array: string[], value: string) => {
    const index = array.indexOf(value)
    if (index > -1) {
      array.splice(index, 1)
    } else {
      array.push(value)
    }
    setSelectedFilters([...array])
  }

  useEffect(() => {
    setPaginaAtual(1)
  }, [searchFilter, selectedFilters, projects.length, searchResults.length, activePlatform])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white/60">Carregando mods...</p>
        </div>
      </div>
    )
  }

  const mostrandoResultadosOnline = Boolean(searchFilter.trim()) || projects.length === 0

  const listaBase = mostrandoResultadosOnline
    ? searchResults
    : filteredProjects

  const totalPaginas = Math.max(1, Math.ceil(listaBase.length / TAMANHO_PAGINA))
  const paginaAplicada = Math.min(paginaAtual, totalPaginas)
  const inicioPagina = (paginaAplicada - 1) * TAMANHO_PAGINA
  const displayedMods = listaBase.slice(inicioPagina, inicioPagina + TAMANHO_PAGINA)

  return (
    <div>
      {/* Barra de busca */}
      <div className="mb-6">
        {!searchFilter && searchResults.length > 0 && (
          <div className="mb-4 text-center">
            <h3 className="text-lg font-semibold text-white mb-2">Mods Populares</h3>
            <p className="text-white/60 text-sm">Descubra mods incríveis para melhorar sua experiência de jogo</p>
          </div>
        )}
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Buscar mods..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-white"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={activePlatform}
              onChange={(e) => setActivePlatform(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-white"
            >
              <option value="modrinth">Modrinth</option>
              <option value="curseforge">CurseForge</option>
            </select>

            <button
              onClick={() => searchMods(searchFilter)}
              disabled={searching || !searchFilter.trim()}
              className="bg-emerald-500 disabled:opacity-50 text-black px-6 py-3 rounded-xl font-medium hover:bg-emerald-400 transition-all"
            >
              {searching ? '🔍 Buscando...' : '🔍 Buscar'}
            </button>
          </div>
        </div>
      </div>

      {searchFilter && searching ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white/60">Buscando mods...</p>
          </div>
        </div>
      ) : displayedMods.length > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {!mostrandoResultadosOnline && filterOptions.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', paddingBottom: '16px' }}>
                <span style={{ marginRight: '4px' }}>Filter:</span>
                {filterOptions.map(filter => (
                  <button
                    key={`content-filter-${filter.id}`}
                    onClick={() => toggleArray(selectedFilters, filter.id)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '9999px',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: selectedFilters.includes(filter.id) ? '#1976d2' : '#f5f5f5',
                      color: selectedFilters.includes(filter.id) ? '#ffffff' : '#333333'
                    }}
                  >
                    {filter.formattedName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedMods.map((mod) => (
              <div
                key={mod.id}
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-1 text-white">{mod.name}</h3>
                      <p className="text-white/60 text-sm">por {mod.author?.name || 'Desconhecido'}</p>
                  </div>
                  {mod.version && (
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full">
                      v{mod.version}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4">
                  {mostrandoResultadosOnline ? (
                    // Mods de busca - botão instalar
                    <button
                      onClick={() => installMod(mod)}
                      className="w-full bg-emerald-500 text-black py-2 rounded-lg font-medium hover:bg-emerald-400 transition-all"
                    >
                      Instalar
                    </button>
                  ) : (
                    // Mods instalados - controles
                    <div className="flex items-center gap-2 w-full">
                      <label className="flex items-center gap-2 text-sm text-white/60">
                        <input
                          type="checkbox"
                          checked={!mod.disabled}
                          onChange={async (evento) => {
                            const habilitado = evento.target.checked
                            try {
                              await invoke('toggle_project_file_enabled', {
                                instanceId: instance.id,
                                projectType: 'mod',
                                fileName: mod.file_name,
                                enabled: habilitado
                              })
                              await recarregarModsInstalados()
                            } catch (error) {
                              console.error('Erro ao alternar estado do mod:', error)
                            }
                          }}
                        />
                        Ativo
                      </label>
                      <button
                        onClick={async () => {
                          try {
                            await invoke('remove_mod', {
                              instanceId: instance.id,
                              modFile: mod.file_name
                            })
                            await recarregarModsInstalados()
                          } catch (error) {
                            console.error('Erro ao remover mod:', error)
                          }
                        }}
                        className="ml-auto text-red-400 hover:text-red-300 px-2 py-1 rounded text-sm"
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-2">
                <button
                  disabled={paginaAplicada <= 1}
                  onClick={() => setPaginaAtual((atual) => Math.max(1, atual - 1))}
                  className="px-3 py-1 rounded border border-white/20 text-white/80 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-sm text-white/70">
                  Página {paginaAplicada} de {totalPaginas}
                </span>
                <button
                  disabled={paginaAplicada >= totalPaginas}
                  onClick={() => setPaginaAtual((atual) => Math.min(totalPaginas, atual + 1))}
                  className="px-3 py-1 rounded border border-white/20 text-white/80 disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        </>
      ) : searchFilter ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <p className="text-white/60 mb-2">Nenhum mod encontrado para "{searchFilter}"</p>
            <p className="text-white/40 text-sm">Tente ajustar sua busca ou selecione outra plataforma</p>
          </div>
        </div>
      ) : (
        <div style={{ width: '100%', maxWidth: '48rem', margin: '0 auto', display: 'flex', flexDirection: 'column', marginTop: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', width: '32rem', margin: '0 auto' }}>
            <img src="/sad-modrinth-bot.webp" alt="Sad Modrinth Bot" style={{ height: '96px' }} />
            <span style={{ color: '#333333', fontWeight: 'bold', fontSize: '24px' }}>
              Você ainda não adicionou nenhum conteúdo a esta instância.
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: '16px', justifyContent: 'center' }}>
            <button style={{ padding: '8px 16px', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Adicionar conteúdo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Mods
