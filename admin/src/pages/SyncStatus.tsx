import { Stack, Table, Badge, Group, Card, TextInput, Select, Text } from '@mantine/core';
import { IconSearch, IconRefresh } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import axios from 'axios';

interface SyncJob {
  id: string;
  type: string;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'waiting';
  progress?: number;
  createdAt: string;
  failedReason?: string;
}

export default function SyncStatus() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>('all');
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/sync/jobs');
      setJobs(response.data);
    } catch (error) {
      console.error('Failed to fetch sync jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'green';
      case 'active':
        return 'blue';
      case 'waiting':
      case 'queued':
        return 'orange';
      case 'failed':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'waiting':
        return 'Queued';
      case 'completed':
        return 'Completed';
      case 'active':
        return 'Running';
      case 'queued':
        return 'Queued';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch = job.id.includes(search) || job.type.includes(search);
    const matchesFilter = filter === 'all' || job.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="xl" fw={700}>
            Sync Jobs
          </Text>
          <Text size="sm" c="dimmed">
            Monitor sync job history and status
          </Text>
        </div>
        <Group>
          <Badge color="blue" variant="light">
            Total: {jobs.length}
          </Badge>
        </Group>
      </Group>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Group grow>
            <TextInput
              placeholder="Search by job ID or type..."
              leftSection={<IconSearch size={14} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <Select
              placeholder="Filter by status"
              data={[
                { value: 'all', label: 'All Jobs' },
                { value: 'completed', label: 'Completed' },
                { value: 'active', label: 'Running' },
                { value: 'waiting', label: 'Queued' },
                { value: 'failed', label: 'Failed' },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </Group>

          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Job ID</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Progress</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredJobs.length > 0 ? (
                filteredJobs.map((job) => (
                  <Table.Tr key={job.id}>
                    <Table.Td>
                      <Text size="sm" truncate>
                        {job.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light">{job.type}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(job.status)}>{getStatusLabel(job.status)}</Badge>
                    </Table.Td>
                    <Table.Td>
                      {job.progress != null ? `${job.progress}%` : job.status === 'completed' ? '100%' : '-'}
                    </Table.Td>
                    <Table.Td>{new Date(job.createdAt).toLocaleString()}</Table.Td>
                  </Table.Tr>
                ))
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={5} align="center" py="md">
                    <Text c="dimmed">No sync jobs found</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );
}
