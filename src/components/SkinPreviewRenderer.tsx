import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Loader2 } from "../iconesPixelados";
import { resolverTexturaMinecraft } from "../lib/texturaMinecraft";
import modeloClassicoRaw from "../assets/models/classic-player.gltf?raw";
import modeloSlimRaw from "../assets/models/slim-player.gltf?raw";

// Cache de modelos GLTF parseados da memória
const cacheModelo = new Map<string, GLTF>();

function parsearModelo(rawJson: string): Promise<GLTF> {
  if (cacheModelo.has(rawJson)) {
    return Promise.resolve(cacheModelo.get(rawJson)!);
  }

  const loader = new GLTFLoader();
  return new Promise<GLTF>((resolve, reject) => {
    loader.parse(
      rawJson,
      "",
      (gltf) => {
        cacheModelo.set(rawJson, gltf);
        resolve(gltf);
      },
      (error) => {
        reject(error);
      },
    );
  });
}

function clonarCenaModelo(source: THREE.Object3D): THREE.Group {
  const cloned = cloneSkeleton(source) as THREE.Group;
  cloned.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((mat) => mat.clone())
      : mesh.material.clone();
  });
  return cloned;
}

// Utility functions for cape and skin texture handling
function createTransparentTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 1, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  return texture;
}

function applyMap(mat: THREE.MeshStandardMaterial, texture: THREE.Texture | null): boolean {
  const hadMap = mat.map !== null;
  const hasMap = texture !== null;
  if (mat.map !== texture) {
    mat.map = texture;
  }
  return hadMap !== hasMap;
}

function setShaderMaterialProperties(
  mat: THREE.MeshStandardMaterial,
  properties: {
    alphaTest: number;
    flatShading: boolean;
    side: THREE.Side;
    toneMapped: boolean;
    transparent?: boolean;
  },
): boolean {
  let needsUpdate = false;
  if (mat.alphaTest !== properties.alphaTest) {
    mat.alphaTest = properties.alphaTest;
    needsUpdate = true;
  }
  if (mat.flatShading !== properties.flatShading) {
    mat.flatShading = properties.flatShading;
    needsUpdate = true;
  }
  if (mat.side !== properties.side) {
    mat.side = properties.side;
    needsUpdate = true;
  }
  if (mat.toneMapped !== properties.toneMapped) {
    mat.toneMapped = properties.toneMapped;
    needsUpdate = true;
  }
  if (properties.transparent !== undefined && mat.transparent !== properties.transparent) {
    mat.transparent = properties.transparent;
    needsUpdate = true;
  }
  return needsUpdate;
}

function setCommonMaterialProperties(mat: THREE.MeshStandardMaterial): void {
  if (mat.metalness !== 0) mat.metalness = 0;
  if (mat.color.getHex() !== 0xffffff) mat.color.set(0xffffff);
  if (mat.roughness !== 1) mat.roughness = 1;
  if (!mat.depthTest) mat.depthTest = true;
  if (!mat.depthWrite) mat.depthWrite = true;
}

function applyTexture(model: THREE.Object3D, texture: THREE.Texture): void {
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const isSkinLayer = mesh.name.endsWith("_Layer");
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((mat: THREE.Material) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (mat.name !== "cape") {
            const mapNeedsUpdate = applyMap(mat, texture);
            const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
              alphaTest: 0.1,
              flatShading: true,
              side: THREE.FrontSide,
              toneMapped: false,
              transparent: isSkinLayer,
            });

            setCommonMaterialProperties(mat);

            if (mapNeedsUpdate || propertiesNeedUpdate) {
              mat.needsUpdate = true;
            }
          }
        }
      });
    }
  });
}

function applyCapeTexture(
  model: THREE.Object3D,
  texture: THREE.Texture | null,
  transparentTexture?: THREE.Texture,
): void {
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((mat: THREE.Material) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (mat.name === "cape") {
            const nextMap = texture || transparentTexture || null;
            const mapNeedsUpdate = applyMap(mat, nextMap);
            const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
              alphaTest: 0.1,
              flatShading: true,
              side: THREE.DoubleSide,
              toneMapped: false,
              transparent: !texture || !!transparentTexture,
            });

            setCommonMaterialProperties(mat);

            if (mapNeedsUpdate || propertiesNeedUpdate) {
              mat.needsUpdate = true;
            }

            mat.visible = !!texture;
          }
        }
      });
    }
  });
}

interface SkinPreviewRendererProps {
  skinUrl: string;
  capeUrl?: string;
  model?: "classic" | "slim";
  height?: number;
  width?: number;
  className?: string;
  onReady?: () => void;
  onFalhaWebgl?: () => void;
}

export const SkinPreviewRenderer: React.FC<SkinPreviewRendererProps> = ({
  skinUrl,
  capeUrl,
  model = "classic",
  height = 400,
  width = 300,
  className,
  onReady,
  onFalhaWebgl,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroModelo, setErroModelo] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [erroTextura, setErroTextura] = useState(false);
  const [carregandoTextura, setCarregandoTextura] = useState(true);
  const aoProntoRef = useRef(onReady);
  aoProntoRef.current = onReady;
  useEffect(() => {
    if (!loading && !carregandoTextura && !erroModelo && !erroTextura) aoProntoRef.current?.();
  }, [loading, carregandoTextura, erroModelo, erroTextura]);

  const playAnimationRef = useRef<(name: string, once?: boolean) => void>(
    () => {},
  );

  const skinTextureRef = useRef<THREE.Texture | null>(null);
  const capeTextureRef = useRef<THREE.Texture | null>(null);
  const transparentTextureRef = useRef<THREE.Texture | null>(null);

  if (!transparentTextureRef.current) {
    transparentTextureRef.current = createTransparentTexture();
  }
  const transparentTexture = transparentTextureRef.current;

  // Efeito principal: Configuração da cena Three.js
  useEffect(() => {
    if (!mountRef.current || !containerRef.current) return;
    setLoading(true);
    setErroModelo(false);
    modelRef.current = null;
    mixerRef.current = null;
    actionsRef.current = {};
    activeActionRef.current = null;

    let descartado = false;

    const initialWidth = containerRef.current.clientWidth || width || 300;
    const initialHeight = containerRef.current.clientHeight || height || 400;

    const camera = new THREE.PerspectiveCamera(
      45,
      initialWidth / initialHeight,
      0.1,
      100,
    );
    camera.position.set(0, 1.1, 4.2);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch (erro) {
      console.error("Não foi possível iniciar a prévia WebGL:", erro);
      setLoading(false);
      setErroModelo(true);
      onFalhaWebgl?.();
      return;
    }
    renderer.setSize(initialWidth, initialHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const tratarPerdaContexto = (evento: Event) => {
      evento.preventDefault();
      if (descartado) return;
      try {
        localStorage.setItem("dome-skins-modo-seguro", "true");
      } catch {
        // A recuperação em memória não depende da persistência do WebView.
      }
      setLoading(false);
      setErroModelo(true);
      onFalhaWebgl?.();
    };
    renderer.domElement.addEventListener("webglcontextlost", tratarPerdaContexto);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.0, 0);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 2.0;
    controls.maxDistance = 8.0;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const scene = new THREE.Scene();

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(-3, 5, 4);
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || descartado) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      if (newWidth === 0 || newHeight === 0) return;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    });
    resizeObserver.observe(containerRef.current);

    const modelRaw = model === "slim" ? modeloSlimRaw : modeloClassicoRaw;

    parsearModelo(modelRaw)
      .then((gltf) => {
        if (descartado) return;
        const object = clonarCenaModelo(gltf.scene);

        object.position.x = 0;
        object.position.y = 0;
        object.rotation.y = Math.PI / 8;

        modelRef.current = object;
        scene.add(object);

        const mixer = new THREE.AnimationMixer(object);
        mixerRef.current = mixer;

        gltf.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          actionsRef.current[clip.name] = action;
        });

        playAnimationRef.current("idle");

        // Aplica as texturas que já estiverem carregadas
        if (skinTextureRef.current) {
          applyTexture(object, skinTextureRef.current);
        }
        applyCapeTexture(object, capeTextureRef.current, transparentTexture);

        setLoading(false);
      })
      .catch((error) => {
        if (descartado) return;
        console.error("Erro ao carregar modelo GLTF:", error);
        setLoading(false);
        setErroModelo(true);
      });

    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (mixerRef.current) mixerRef.current.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      descartado = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", tratarPerdaContexto);
      renderer.dispose();
      renderer.forceContextLoss();
      scene.traverse((objeto) => {
        const malha = objeto as THREE.Mesh;
        if (!malha.isMesh) return;
        const materiais = Array.isArray(malha.material) ? malha.material : [malha.material];
        materiais.forEach((material) => material.dispose());
      });
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      if (rendererRef.current === renderer) rendererRef.current = null;
      modelRef.current = null;
      mixerRef.current = null;
      actionsRef.current = {};
      activeActionRef.current = null;
    };
  }, [model, onFalhaWebgl, tentativa]);

  // Helpers de Animação
  const playActive = (newAction: THREE.AnimationAction, once: boolean) => {
    const current = activeActionRef.current;
    if (current === newAction && current.isRunning()) return;

    if (current) {
      current.fadeOut(0.2);
    }

    newAction.reset();
    newAction.fadeIn(0.2);

    if (once) {
      newAction.setLoop(THREE.LoopOnce, 1);
      newAction.clampWhenFinished = true;
      const restoreIdle = (e: any) => {
        if (e.action === newAction) {
          mixerRef.current?.removeEventListener("finished", restoreIdle);
          playAnimationRef.current("idle");
        }
      };
      mixerRef.current?.addEventListener("finished", restoreIdle);
    } else {
      newAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    newAction.play();
    activeActionRef.current = newAction;
  };

  const playAnimation = (name: string, once: boolean = false) => {
    const actions = actionsRef.current;
    const clipName = Object.keys(actions).find((key) =>
      key.toLowerCase().includes(name.toLowerCase()),
    );

    if (!clipName) {
      if (name === "idle" && Object.keys(actions).length > 0) {
        playActive(actions[Object.keys(actions)[0]], once);
      }
      return;
    }
    playActive(actions[clipName], once);
  };

  useEffect(() => {
    playAnimationRef.current = playAnimation;
  });

  // Load Skin Texture
  useEffect(() => {
    if (!skinUrl) return;

    let descartada = false;
    setErroTextura(false);
    setCarregandoTextura(true);
    const textureLoader = new THREE.TextureLoader();
    void resolverTexturaMinecraft(skinUrl).then((url) => textureLoader.load(
      url,
      (texture) => {
        if (descartada) {
          texture.dispose();
          return;
        }
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;

        skinTextureRef.current?.dispose();
        skinTextureRef.current = texture;
        setCarregandoTextura(false);

        if (modelRef.current) {
          applyTexture(modelRef.current, texture);
        }
      },
      undefined,
      () => { if (!descartada) { setErroTextura(true); setCarregandoTextura(false); } },
    )).catch(() => { if (!descartada) { setErroTextura(true); setCarregandoTextura(false); } });

    return () => {
      descartada = true;
    };
  }, [skinUrl, tentativa]);

  // Load Cape Texture
  useEffect(() => {
    if (capeUrl) {
      let descartada = false;
      const textureLoader = new THREE.TextureLoader();
      void resolverTexturaMinecraft(capeUrl).then((url) => textureLoader.load(
        url,
        (texture) => {
          if (descartada) {
            texture.dispose();
            return;
          }
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;

          capeTextureRef.current?.dispose();
          capeTextureRef.current = texture;

          if (modelRef.current) {
            applyCapeTexture(modelRef.current, texture, transparentTexture);
          }
        },
        undefined,
        (err) => console.error("Erro ao carregar textura da capa:", err),
      )).catch(() => { if (!descartada) setErroTextura(true); });

      return () => {
        descartada = true;
      };
    } else {
      capeTextureRef.current?.dispose();
      capeTextureRef.current = null;
      if (modelRef.current) {
        applyCapeTexture(modelRef.current, null, transparentTexture);
      }
    }
  }, [capeUrl, tentativa]);

  useEffect(() => {
    return () => {
      skinTextureRef.current?.dispose();
      capeTextureRef.current?.dispose();
    };
  }, []);

  const handleCanvasClick = () => {
    playAnimation("interact", true);
  };

  return (
    <div
      className={`relative flex items-center justify-center ${className || ""}`}
      style={{ width: "100%", height: "100%" }}
      ref={containerRef}
      onClick={handleCanvasClick}
    >
      {/* Container Dedicado ao Three.js para não conflitar com Loader */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {(loading || carregandoTextura) && !erroModelo && !erroTextura && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <Loader2 className="animate-spin text-emerald-500" size={32} />
        </div>
      )}
      {(erroModelo || erroTextura) && !loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-xs text-white/45">
            {erroTextura ? "Não foi possível carregar a textura. Tente novamente." : "Não foi possível carregar o modelo 3D."}
          </span>
          <button
            type="button"
            onClick={() => setTentativa((valor) => valor + 1)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
};
