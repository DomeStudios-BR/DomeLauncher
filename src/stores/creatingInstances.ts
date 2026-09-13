export interface CreatingInstance {
  id: string;
  name: string;
  version: string;
  type: string;
  status: "pending" | "downloading" | "installing" | "complete" | "error";
  progress: number;
  progressoIndeterminado?: boolean;
  message: string;
  icon: string;
}

// Estado simples em memória
let creatingInstances: CreatingInstance[] = [];
let listeners: (() => void)[] = [];

const notify = () => {
  listeners.forEach((l) => l());
};

export function subscribeToCreating(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getCreatingInstances(): CreatingInstance[] {
  return [...creatingInstances];
}

export function addCreatingInstance(instance: CreatingInstance) {
  creatingInstances = [...creatingInstances, instance];
  notify();
}

export function updateCreatingInstance(
  id: string,
  updates: Partial<CreatingInstance>,
) {
  creatingInstances = creatingInstances.map((i) =>
    i.id === id ? { ...i, ...updates } : i,
  );
  notify();
}

export function removeCreatingInstance(id: string) {
  creatingInstances = creatingInstances.filter((i) => i.id !== id);
  notify();
}

export function completeCreatingInstance(
  id: string,
  message = "Instância criada com sucesso!",
) {
  updateCreatingInstance(id, {
    status: "complete",
    progress: 100,
    progressoIndeterminado: false,
    message,
  });
  // Remover após alguns segundos
  setTimeout(() => {
    removeCreatingInstance(id);
  }, 3000);
}

export function errorCreatingInstance(id: string, message: string) {
  updateCreatingInstance(id, {
    status: "error",
    progressoIndeterminado: false,
    message,
  });
}
