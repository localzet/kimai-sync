import { Stack, Grid, Card, Text, Badge, Group, Button, RingProgress, Center, SimpleGrid } from '@mantine/core';
import { IconCheck, IconClock, IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import axios from 'axios';

interface Stats {
  total: number;
  synced: number;
  unsynced: number;
  lastSyncedAt?: string;
}

export default function Dashboard() {
  const [health, setHealth] = useState<boolean>(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check API health
        const healthResponse = await axios.get('/api/health');
        setHealth(healthResponse.status === 200);

        // Fetch sync statistics
        const statsResponse = await axios.get('/api/sync/stats');
        setStats(statsResponse.data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        setHealth(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const response = await axios.post('/api/sync/full');
      console.log('Full sync triggered:', response.data);
      // Refresh stats after triggering sync
      setTimeout(async () => {
        try {
          const statsResponse = await axios.get('/api/sync/stats');
          setStats(statsResponse.data);
        } catch (e) {
          console.error('Failed to refresh stats:', e);
        }
      }, 2000);
    } catch (error) {
      console.error('Failed to trigger sync:', error);
    } finally {
      setSyncing(false);
    }
  };

  const syncPercent = stats ? Math.round((stats.synced / (stats.total || 1)) * 100) || 0 : 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="xl" fw={700}>
            Dashboard
          </Text>
          <Text size="sm" c="dimmed">
            Manage your Kimai to Notion sync
          </Text>
        </div>
        <Button 
          leftSection={<IconRefresh size={14} />} 
          color="blue"
          onClick={handleTriggerSync}
          loading={syncing}
        >
          Trigger Sync
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Text fw={500}>API Status</Text>
            <Badge color={health ? 'green' : 'red'} variant="filled">
              {health ? 'Online' : 'Offline'}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="xs">
            Backend connection status
          </Text>
        </Card>

        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Text fw={500}>Total Entries</Text>
            <Badge size="lg" variant="light">
              {stats?.total ?? 0}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="xs">
            Time entries in Kimai
          </Text>
        </Card>

        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <Group justify="space-between">
            <Text fw={500}>Last Sync</Text>
            <Badge variant="light">
              {stats?.lastSyncedAt ? new Date(stats.lastSyncedAt).toLocaleDateString() : 'Never'}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="xs">
            Last synchronized
          </Text>
        </Card>
      </SimpleGrid>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Group justify="space-between" mb="lg">
          <div>
            <Text fw={500}>Sync Progress</Text>
            <Text size="sm" c="dimmed">
              {stats?.synced ?? 0} of {stats?.total ?? 0} entries synced
            </Text>
          </div>
          <Badge color="blue" variant="light">
            {syncPercent}%
          </Badge>
        </Group>

        <Center>
          <RingProgress
            sections={[{ value: syncPercent, color: 'blue' }]}
            size={200}
            thickness={12}
            label={
              <Stack align="center">
                <Text fw={700} size="xl">
                  {syncPercent}%
                </Text>
                <Text size="xs" c="dimmed">
                  Complete
                </Text>
              </Stack>
            }
          />
        </Center>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Card shadow="sm" padding="lg" radius="md" withBorder style={{ borderLeft: '4px solid #12b886' }}>
          <Group gap="sm">
            <IconCheck size={24} color="#12b886" />
            <div>
              <Text fw={500}>{stats?.synced ?? 0}</Text>
              <Text size="sm" c="dimmed">
                Synced Entries
              </Text>
            </div>
          </Group>
        </Card>

        <Card shadow="sm" padding="lg" radius="md" withBorder style={{ borderLeft: '4px solid #ffa94d' }}>
          <Group gap="sm">
            <IconAlertCircle size={24} color="#ffa94d" />
            <div>
              <Text fw={500}>{stats?.unsynced ?? 0}</Text>
              <Text size="sm" c="dimmed">
                Pending Sync
              </Text>
            </div>
          </Group>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
