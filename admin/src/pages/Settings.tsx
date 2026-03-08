import { Stack, Card, Text, TextInput, PasswordInput, Button, Group, Switch, SimpleGrid, Badge, Alert } from '@mantine/core';
import { useState, useEffect } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import axios from 'axios';

interface Config {
  kimaiUrl: string;
  kimaiApiKey: string;
  notionApiKey: string;
  syncInterval: string;
  syncEnabled: boolean;
  lastUpdatedAt: string;
}

interface ApiStatus {
  kimai: 'connected' | 'error' | 'pending';
  notion: 'connected' | 'error' | 'pending';
}

export default function Settings() {
  const [config, setConfig] = useState<Config>({
    kimaiUrl: '',
    kimaiApiKey: '',
    notionApiKey: '',
    syncInterval: '',
    syncEnabled: true,
    lastUpdatedAt: '',
  });
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    kimai: 'pending',
    notion: 'pending',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load config from backend on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Get config from backend
        const response = await axios.get('/api/config');
        setConfig(response.data);
        setError(null);
      } catch (err) {
        console.error('Failed to load config:', err);
        // Load from localStorage as fallback
        const cached = localStorage.getItem('appConfig');
        if (cached) {
          setConfig(JSON.parse(cached));
        }
      }
    };

    loadConfig();
  }, []);

  // Check API status on mount and periodically via backend
  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        // Check API status through backend proxy
        const response = await axios.get('/api/health');
        if (response.status === 200) {
          setApiStatus({
            kimai: 'connected',
            notion: 'connected',
          });
        }
      } catch (err) {
        console.error('Error checking API status:', err);
        setApiStatus({
          kimai: 'error',
          notion: 'error',
        });
      }
    };

    const interval = setInterval(checkApiStatus, 60000); // Check every minute
    checkApiStatus(); // Check immediately
    return () => clearInterval(interval);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Save to backend
      await axios.post('/api/config', {
        ...config,
        lastUpdatedAt: new Date().toISOString(),
      });

      // Save to localStorage as backup
      localStorage.setItem('appConfig', JSON.stringify(config));

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
      // Still save to localStorage
      localStorage.setItem('appConfig', JSON.stringify(config));
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'green';
      case 'error':
        return 'red';
      case 'pending':
        return 'gray';
      default:
        return 'gray';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'error':
        return 'Error';
      case 'pending':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Text size="xl" fw={700}>
          Settings
        </Text>
        <Text size="sm" c="dimmed">
          Configure API connections and sync preferences
        </Text>
      </div>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      )}

      {success && (
        <Alert icon={<IconAlertCircle size={16} />} color="green" title="Success">
          Settings saved successfully
        </Alert>
      )}

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <div>
            <Text fw={500} mb="xs">
              Kimai Configuration
            </Text>
            <Stack gap="sm">
              <TextInput
                label="Kimai URL"
                placeholder="https://your-kimai-instance.com"
                value={config.kimaiUrl}
                onChange={(e) => setConfig({ ...config, kimaiUrl: e.currentTarget.value })}
              />
              <PasswordInput
                label="API Key"
                placeholder="Your Kimai API key from settings"
                value={config.kimaiApiKey}
                onChange={(e) => setConfig({ ...config, kimaiApiKey: e.currentTarget.value })}
              />
            </Stack>
          </div>

          <hr />

          <div>
            <Text fw={500} mb="xs">
              Notion Configuration
            </Text>
            <Stack gap="sm">
              <PasswordInput
                label="API Key"
                placeholder="Your Notion API key (bearer token)"
                value={config.notionApiKey}
                onChange={(e) => setConfig({ ...config, notionApiKey: e.currentTarget.value })}
              />
            </Stack>
          </div>

          <hr />

          <div>
            <Text fw={500} mb="xs">
              Sync Settings
            </Text>
            <Stack gap="sm">
              <SimpleGrid cols={2} spacing="sm">
                <TextInput
                  label="Cron Expression"
                  placeholder="*/5 * * * *"
                  value={config.syncInterval}
                  onChange={(e) => setConfig({ ...config, syncInterval: e.currentTarget.value })}
                  description="e.g., */5 * * * * (every 5 min)"
                />
                <div>
                  <Text size="sm" fw={500} mb="4">
                    Auto Sync
                  </Text>
                  <Switch
                    checked={config.syncEnabled}
                    onChange={(e) => setConfig({ ...config, syncEnabled: e.currentTarget.checked })}
                    label={config.syncEnabled ? 'Enabled' : 'Disabled'}
                  />
                </div>
              </SimpleGrid>
            </Stack>
          </div>

          <Group justify="space-between">
            <Group gap="xs">
              <Badge color="blue" variant="light">
                Last updated: {config.lastUpdatedAt ? new Date(config.lastUpdatedAt).toLocaleString() : 'Never'}
              </Badge>
            </Group>
            <Button onClick={handleSave} loading={saving}>
              Save Settings
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder style={{ borderLeft: '4px solid #868e96' }}>
        <Stack gap="sm">
          <Text fw={500}>Backend Status</Text>
          <SimpleGrid cols={2} spacing="sm">
            <div>
              <Text size="sm" c="dimmed">
                API Server
              </Text>
              <Badge color={getStatusColor(apiStatus.kimai)} variant="dot">
                {getStatusLabel(apiStatus.kimai)}
              </Badge>
            </div>
            <div>
              <Text size="sm" c="dimmed">
                Configured
              </Text>
              <Badge color={config.kimaiUrl && config.notionApiKey ? 'green' : 'orange'} variant="dot">
                {config.kimaiUrl && config.notionApiKey ? 'Complete' : 'Incomplete'}
              </Badge>
            </div>
          </SimpleGrid>
        </Stack>
      </Card>
    </Stack>
  );
}
