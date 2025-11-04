export default function Home() {
  return (
    <div className="min-h-screen bg-background p-8">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">SIDFlow Control Panel</h1>
        <p className="text-muted-foreground mb-8">
          Local web interface for orchestrating SID playback, rating, and classification
        </p>
        <div className="border rounded-lg p-6 bg-card">
          <p className="text-sm text-muted-foreground">
            Web server is running. API endpoints will be available soon.
          </p>
        </div>
      </main>
    </div>
  );
}
