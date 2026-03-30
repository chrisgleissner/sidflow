'use client';

import { type PersonaId, PERSONA_IDS, PERSONAS } from '@sidflow/common';

const PERSONA_DESCRIPTIONS: Record<PersonaId, string> = {
  fast_paced: 'High energy, rhythmic drive',
  slow_ambient: 'Calm, low tempo',
  melodic: 'Rich melodies, harmonic depth',
  experimental: 'Unusual timbres, sonic exploration',
  nostalgic: 'Classic SID, warm familiarity',
  composer_focus: 'One composer, without manual browsing',
  era_explorer: 'Historically coherent era journeys',
  deep_discovery: 'Obscure deep cuts near your taste',
  theme_hunter: 'Theme-led stations from track titles',
};

const AUDIO_PERSONA_IDS: PersonaId[] = PERSONA_IDS.filter(
  (id) => PERSONAS[id].kind === 'audio'
) as PersonaId[];

const HYBRID_PERSONA_IDS: PersonaId[] = PERSONA_IDS.filter(
  (id) => PERSONAS[id].kind === 'hybrid'
) as PersonaId[];

interface PersonaBarProps {
  activePersona: PersonaId | null;
  onPersonaChange: (persona: PersonaId | null) => void;
  disabled?: boolean;
}

function PersonaButton({
  personaId,
  isActive,
  disabled,
  onClick,
}: {
  personaId: PersonaId;
  isActive: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const persona = PERSONAS[personaId];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
        isActive
          ? 'border-green-500 bg-green-500/10 text-green-400'
          : 'border-neutral-700 bg-neutral-800/50 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      title={PERSONA_DESCRIPTIONS[personaId]}
    >
      <span className="font-medium leading-tight">{persona.label}</span>
      <span className="text-[10px] leading-tight opacity-70">
        {PERSONA_DESCRIPTIONS[personaId]}
      </span>
    </button>
  );
}

export default function PersonaBar({
  activePersona,
  onPersonaChange,
  disabled,
}: PersonaBarProps) {
  const handleClick = (id: PersonaId) => {
    if (disabled) return;
    onPersonaChange(activePersona === id ? null : id);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Audio-led modes */}
      <div className="flex flex-wrap gap-1">
        {AUDIO_PERSONA_IDS.map((id) => (
          <PersonaButton
            key={id}
            personaId={id}
            isActive={activePersona === id}
            disabled={disabled}
            onClick={() => handleClick(id)}
          />
        ))}
      </div>
      {/* Metadata-led modes */}
      <div className="flex flex-wrap gap-1">
        {HYBRID_PERSONA_IDS.map((id) => (
          <PersonaButton
            key={id}
            personaId={id}
            isActive={activePersona === id}
            disabled={disabled}
            onClick={() => handleClick(id)}
          />
        ))}
      </div>
      {!activePersona && (
        <p className="text-[10px] text-neutral-500">
          Choose a listening mode to shape your station
        </p>
      )}
    </div>
  );
}
