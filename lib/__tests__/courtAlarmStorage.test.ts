// lib/__tests__/courtAlarmStorage.test.ts — la mémoire des sonneries de
// terrain doit survivre à l'app tuée, et jamais planter si le stockage boude.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const magasin = new Map<string, string>();
let enPanne = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => {
      if (enPanne) throw new Error('stockage indisponible');
      return [...magasin.keys()];
    },
    multiGet: async (keys: string[]) => {
      if (enPanne) throw new Error('stockage indisponible');
      return keys.map(k => [k, magasin.get(k) ?? null] as [string, string | null]);
    },
    multiRemove: async (keys: string[]) => {
      if (enPanne) throw new Error('stockage indisponible');
      for (const k of keys) magasin.delete(k);
    },
    setItem: async (k: string, v: string) => {
      if (enPanne) throw new Error('stockage indisponible');
      magasin.set(k, v);
    },
    removeItem: async (k: string) => {
      if (enPanne) throw new Error('stockage indisponible');
      magasin.delete(k);
    },
    getItem: async (k: string) => {
      if (enPanne) throw new Error('stockage indisponible');
      return magasin.get(k) ?? null;
    },
  },
}));

import {
  alarmStorageKey, parseAlarmIds, alarmKeysToPurge,
  loadAlarmMemory, saveAlarmMemory, persistAlarmMemory, purgeAlarmMemory,
} from '../courtAlarmStorage';

beforeEach(() => {
  magasin.clear();
  enPanne = false;
});

describe('la cle de stockage d un match', () => {
  it('une ligne par match, jamais un blob unique', () => {
    expect(alarmStorageKey('m1')).toBe('courtAlarm:m1');
    expect(alarmStorageKey('m1')).not.toBe(alarmStorageKey('m2'));
  });
});

describe('lire les identifiants poses pour un match', () => {
  it('un tableau JSON valide', () => {
    expect(parseAlarmIds('["a","b"]')).toEqual(['a', 'b']);
  });

  it('rien plutot qu une exception sur du JSON illisible', () => {
    expect(parseAlarmIds('{pas du json')).toEqual([]);
  });

  it('rien sur une valeur absente', () => {
    expect(parseAlarmIds(null)).toEqual([]);
    expect(parseAlarmIds(undefined)).toEqual([]);
  });

  it('rien sur un JSON valide qui n est pas un tableau', () => {
    expect(parseAlarmIds('{"a":1}')).toEqual([]);
  });

  it('ecarte les elements qui ne sont pas des chaines', () => {
    expect(parseAlarmIds('["a", 1, null, "b"]')).toEqual(['a', 'b']);
  });
});

describe('les cles a purger', () => {
  const cles = ['courtAlarm:m1', 'courtAlarm:m2', 'autreChose:x'];

  it('garde la cle du match courant, efface les autres cles de terrain', () => {
    expect(alarmKeysToPurge(cles, 'm1')).toEqual(['courtAlarm:m2']);
  });

  it('purge tout quand on ne joue plus cette rotation', () => {
    expect(alarmKeysToPurge(cles, null)).toEqual(['courtAlarm:m1', 'courtAlarm:m2']);
  });

  it('ne touche jamais aux cles d un autre usage de l app', () => {
    expect(alarmKeysToPurge(cles, null)).not.toContain('autreChose:x');
  });
});

describe('relire la memoire au montage de l ecran', () => {
  it('reconstitue la Map depuis les lignes du stockage', async () => {
    magasin.set('courtAlarm:m1', JSON.stringify(['n1', 'n2']));
    magasin.set('courtAlarm:m2', JSON.stringify(['n3']));
    magasin.set('autreChose:x', 'peu importe');
    const mem = await loadAlarmMemory();
    expect(mem.get('m1')).toEqual(['n1', 'n2']);
    expect(mem.get('m2')).toEqual(['n3']);
    expect(mem.has('x')).toBe(false);
  });

  it('rien en stockage, rien en memoire', async () => {
    const mem = await loadAlarmMemory();
    expect(mem.size).toBe(0);
  });

  it('stockage indisponible : memoire vide, jamais une exception', async () => {
    enPanne = true;
    await expect(loadAlarmMemory()).resolves.toEqual(new Map());
  });
});

describe('ecrire la memoire d un match', () => {
  it('pose la ligne', async () => {
    await saveAlarmMemory('m1', ['n1', 'n2']);
    expect(magasin.get('courtAlarm:m1')).toBe(JSON.stringify(['n1', 'n2']));
  });

  it('une liste vide efface la ligne plutot que d ecrire un tableau vide', async () => {
    magasin.set('courtAlarm:m1', JSON.stringify(['n1']));
    await saveAlarmMemory('m1', []);
    expect(magasin.has('courtAlarm:m1')).toBe(false);
  });

  it('stockage indisponible : n echoue pas', async () => {
    enPanne = true;
    await expect(saveAlarmMemory('m1', ['n1'])).resolves.toBeUndefined();
  });
});

describe('persister les changements faits par syncCourtAlarms', () => {
  it('reecrit les entrees encore presentes', async () => {
    const mem = new Map([['m1', ['n1', 'n2']]]);
    await persistAlarmMemory([], mem);
    expect(magasin.get('courtAlarm:m1')).toBe(JSON.stringify(['n1', 'n2']));
  });

  it('efface une entree annulee entre l avant et l apres', async () => {
    // Le score est arrive : syncCourtAlarms a retire "m1" de la Map. Sans
    // l instantane "avant", on ne verrait jamais qu il fallait l effacer du
    // stockage — la sonnerie resterait posee malgre le score deja saisi.
    magasin.set('courtAlarm:m1', JSON.stringify(['n1']));
    const mem = new Map<string, string[]>(); // m1 retire par syncCourtAlarms
    await persistAlarmMemory(['m1'], mem);
    expect(magasin.has('courtAlarm:m1')).toBe(false);
  });
});

describe('purger les rotations passees', () => {
  it('efface les cles de terrain qui ne sont plus le match courant', async () => {
    magasin.set('courtAlarm:m1', JSON.stringify(['n1']));
    magasin.set('courtAlarm:m2', JSON.stringify(['n2']));
    await purgeAlarmMemory('m2');
    expect(magasin.has('courtAlarm:m1')).toBe(false);
    expect(magasin.has('courtAlarm:m2')).toBe(true);
  });

  it('stockage indisponible : ne jette pas', async () => {
    enPanne = true;
    await expect(purgeAlarmMemory('m1')).resolves.toBeUndefined();
  });
});
