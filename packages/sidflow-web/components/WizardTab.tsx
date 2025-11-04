'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, ChevronLeft } from 'lucide-react';

interface WizardTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
  onSwitchTab: (tab: string) => void;
}

const STEPS = [
  {
    id: 'fetch',
    title: 'STEP 1: FETCH',
    description: 'Download the HVSC collection',
    details: 'Start by downloading or updating your SID music collection from the High Voltage SID Collection.',
    action: 'Go to Fetch Tab',
    tab: 'fetch',
  },
  {
    id: 'rate',
    title: 'STEP 2: RATE',
    description: 'Rate some tracks manually',
    details: 'Provide ratings for at least 10-20 tracks to help the system learn your preferences.',
    action: 'Go to Rate Tab',
    tab: 'rate',
  },
  {
    id: 'classify',
    title: 'STEP 3: CLASSIFY',
    description: 'Classify your collection',
    details: 'Analyze all SID files and extract audio features. This will predict ratings for unrated tracks.',
    action: 'Go to Classify Tab',
    tab: 'classify',
  },
  {
    id: 'train',
    title: 'STEP 4: TRAIN',
    description: 'Train the ML model',
    details: 'Train the machine learning model on your ratings to improve future predictions.',
    action: 'Go to Train Tab',
    tab: 'train',
  },
  {
    id: 'play',
    title: 'STEP 5: PLAY',
    description: 'Enjoy your music!',
    details: 'Generate mood-based playlists and play your favorite SID music with personalized recommendations.',
    action: 'Go to Play Tab',
    tab: 'play',
  },
];

export function WizardTab({ onStatusChange, onSwitchTab }: WizardTabProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const step = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleGoToTab = () => {
    onSwitchTab(step.tab);
  };

  return (
    <div className="space-y-6">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">SETUP WIZARD</CardTitle>
          <CardDescription className="text-muted-foreground">
            Follow these steps to get started with SIDFlow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-bold text-accent">
                  {currentStep + 1} of {STEPS.length}
                </span>
              </div>
              <Progress value={progress} className="h-3" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent text-2xl">
            {step.title}
          </CardTitle>
          <CardDescription className="text-lg font-bold text-foreground">
            {step.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-base leading-relaxed">
            {step.details}
          </p>

          {step.id === 'fetch' && (
            <div className="space-y-2 p-4 bg-muted rounded border-2 border-border">
              <p className="text-sm font-bold text-accent">WHAT HAPPENS:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Downloads latest HVSC archive</li>
                <li>Extracts SID files to workspace</li>
                <li>Takes 5-10 minutes on first run</li>
              </ul>
            </div>
          )}

          {step.id === 'rate' && (
            <div className="space-y-2 p-4 bg-muted rounded border-2 border-border">
              <p className="text-sm font-bold text-accent">RATING DIMENSIONS:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Energy (1-5): Intensity level</li>
                <li>Mood (1-5): Dark to Bright</li>
                <li>Complexity (1-5): Simple to Complex</li>
                <li>Preference (1-5): Personal taste</li>
              </ul>
            </div>
          )}

          {step.id === 'classify' && (
            <div className="space-y-2 p-4 bg-muted rounded border-2 border-border">
              <p className="text-sm font-bold text-accent">CLASSIFICATION PROCESS:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Converts SID to WAV (cached)</li>
                <li>Extracts audio features</li>
                <li>Predicts ratings using ML</li>
                <li>Takes 30-60 minutes for full HVSC</li>
              </ul>
            </div>
          )}

          {step.id === 'train' && (
            <div className="space-y-2 p-4 bg-muted rounded border-2 border-border">
              <p className="text-sm font-bold text-accent">MODEL TRAINING:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Learns from your manual ratings</li>
                <li>Improves prediction accuracy</li>
                <li>Run periodically after rating more tracks</li>
                <li>Takes 5-15 minutes</li>
              </ul>
            </div>
          )}

          {step.id === 'play' && (
            <div className="space-y-2 p-4 bg-muted rounded border-2 border-border">
              <p className="text-sm font-bold text-accent">MOOD PRESETS:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Quiet: Low energy, calm mood</li>
                <li>Energetic: High energy, upbeat</li>
                <li>Dark: Somber, atmospheric</li>
                <li>Bright: Happy, cheerful</li>
                <li>Complex: Sophisticated arrangements</li>
              </ul>
            </div>
          )}

          <Button
            onClick={handleGoToTab}
            className="w-full retro-glow"
            size="lg"
          >
            {step.action}
          </Button>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentStep === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          PREVIOUS
        </Button>
        <Button
          variant="outline"
          onClick={handleNext}
          disabled={currentStep === STEPS.length - 1}
          className="gap-2"
        >
          NEXT
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* All Steps Overview */}
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">ALL STEPS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {STEPS.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setCurrentStep(idx)}
                className={`w-full text-left p-3 rounded border-2 transition-colors ${
                  idx === currentStep
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <p className={`text-sm font-bold ${idx === currentStep ? 'text-accent' : ''}`}>
                  {s.title}
                </p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
