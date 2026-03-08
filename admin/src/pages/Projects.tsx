import { Stack, Table, Badge, Button, Group, Card, Text, ActionIcon, Menu, TextInput, Modal, Input, Alert } from '@mantine/core';
import { IconFolders, IconDotsVertical, IconEdit, IconTrash, IconSearch, IconPlus, IconAlertCircle } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import axios from 'axios';

interface ProjectResponse {
  id: string;
  name: string;
  kimaiId: number;
  synced: number;
  total: number;
}

export default function Projects() {
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectResponse | null>(null);
  const [formData, setFormData] = useState({ name: '', kimaiId: '' });
  const [error, setError] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateData, setTemplateData] = useState({
    templateId: '',
    propertyMap: {
      title: 'Name',
      date: 'Date',
      duration: 'Duration',
      activity: 'Activity',
      tags: 'Tags',
      project: 'Project',
      kimaiId: 'Kimai ID',
    },
  });

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/projects');
      setProjects(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to load projects');
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleAddProject = async () => {
    if (!formData.name || !formData.kimaiId) {
      setError('Project name and Kimai ID are required');
      return;
    }

    try {
      await axios.post('/api/projects', {
        name: formData.name,
        kimaiId: parseInt(formData.kimaiId),
      });
      setFormData({ name: '', kimaiId: '' });
      setAddModalOpen(false);
      setError(null);
      await fetchProjects();
    } catch (err) {
      setError('Failed to create project');
      console.error('Failed to create project:', err);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;

    try {
      await axios.delete(`/api/projects/${selectedProject.id}`);
      setDeleteConfirmOpen(false);
      setSelectedProject(null);
      setError(null);
      await fetchProjects();
    } catch (err) {
      setError('Failed to delete project');
      console.error('Failed to delete project:', err);
    }
  };

  const handleOpenTemplate = async (project: ProjectResponse) => {
    try {
      const response = await axios.get(`/api/projects/${project.id}/template`);
      setSelectedProject(project);
      setTemplateData({
        templateId: response.data.template?.templateId || '',
        propertyMap: response.data.template ? {
          title: response.data.template.title || 'Name',
          date: response.data.template.date || 'Date',
          duration: response.data.template.duration || 'Duration',
          activity: response.data.template.activity || 'Activity',
          tags: response.data.template.tags || 'Tags',
          project: response.data.template.project || 'Project',
          kimaiId: response.data.template.kimaiId || 'Kimai ID',
        } : {
          title: 'Name',
          date: 'Date',
          duration: 'Duration',
          activity: 'Activity',
          tags: 'Tags',
          project: 'Project',
          kimaiId: 'Kimai ID',
        },
      });
      setTemplateModalOpen(true);
    } catch (err) {
      setError('Failed to load template');
      console.error('Failed to load template:', err);
    }
  };

  const handleSaveTemplate = async () => {
    if (!selectedProject) return;
    if (
      !templateData.propertyMap.title ||
      !templateData.propertyMap.date ||
      !templateData.propertyMap.duration ||
      !templateData.propertyMap.activity ||
      !templateData.propertyMap.kimaiId
    ) {
      setError('Title, Date, Duration, Activity, and Kimai ID are required');
      return;
    }

    try {
      await axios.put(`/api/projects/${selectedProject.id}/template`, {
        templateId: templateData.templateId && templateData.templateId.trim() ? templateData.templateId.trim() : null,
        propertyMap: templateData.propertyMap,
      });
      setTemplateModalOpen(false);
      setError(null);
      await fetchProjects();
    } catch (err) {
      setError('Failed to save template');
      console.error('Failed to save template:', err);
    }
  };

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()) ||
    project.kimaiId.toString().includes(search)
  );

  const getSyncPercent = (synced: number, total: number) => {
    return total === 0 ? 0 : Math.round((synced / total) * 100);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="xl" fw={700}>
            Projects
          </Text>
          <Text size="sm" c="dimmed">
            Manage Kimai projects and Notion mappings
          </Text>
        </div>
        <Button leftSection={<IconPlus size={14} />} onClick={() => setAddModalOpen(true)}>
          Add Project
        </Button>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      )}

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <TextInput
            placeholder="Search projects..."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />

          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Project Name</Table.Th>
                <Table.Th>Kimai ID</Table.Th>
                <Table.Th>Synced</Table.Th>
                <Table.Th>Progress</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredProjects.length > 0 ? (
                filteredProjects.map((project) => {
                  const percent = getSyncPercent(project.synced, project.total);
                  return (
                    <Table.Tr key={project.id}>
                      <Table.Td>
                        <Text fw={500}>{project.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light">{project.kimaiId}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {project.synced}/{project.total}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={percent === 100 ? 'green' : percent > 50 ? 'blue' : 'yellow'}
                          variant="light"
                        >
                          {percent}%
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Menu shadow="md" position="bottom-end">
                          <Menu.Target>
                            <ActionIcon variant="default" size="xs">
                              <IconDotsVertical size={14} />
                            </ActionIcon>
                          </Menu.Target>

                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => handleOpenTemplate(project)}>
                              Configure Template
                            </Menu.Item>
                            <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => {
                              setSelectedProject(project);
                              setDeleteConfirmOpen(true);
                            }}>
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={6} align="center" py="md">
                    <Text c="dimmed">
                      {loading ? 'Loading projects...' : 'No projects found'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      <Modal title="Add Project" opened={addModalOpen} onClose={() => setAddModalOpen(false)}>
        <Stack gap="md">
          <Input
            label="Project Name"
            placeholder="My Project"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.currentTarget.value })}
          />
          <Input
            label="Kimai Project ID"
            type="number"
            placeholder="123"
            value={formData.kimaiId}
            onChange={(e) => setFormData({ ...formData, kimaiId: e.currentTarget.value })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddProject}>Create</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        title="Confirm Delete"
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <Stack gap="md">
          <Text>
            Are you sure you want to delete the project "<strong>{selectedProject?.name}</strong>"?
            This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDeleteProject}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        title={`Configure Notion Template - ${selectedProject?.name}`}
        opened={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        size="lg"
      >
        <Stack gap="md">
          <div>
            <Text size="sm" fw={500} mb={4}>
              Template ID (Optional)
            </Text>
            <Text size="xs" c="dimmed" mb={8}>
              Optional identifier for this template. All projects sync to the database specified in NOTION_DATABASE_ID environment variable.
            </Text>
            <Input
              label="Template ID"
              placeholder="e.g., my-template-id (optional)"
              value={templateData.templateId}
              onChange={(e) => setTemplateData({ ...templateData, templateId: e.currentTarget.value })}
            />
          </div>

          <Text fw={500} size="sm">
            Property Mapping (Required)
          </Text>

          <Input
            label="Title Property"
            placeholder="e.g., Name (default)"
            value={templateData.propertyMap.title}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, title: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Date Property"
            placeholder="e.g., Date (default)"
            value={templateData.propertyMap.date}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, date: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Duration Property"
            placeholder="e.g., Duration (default)"
            value={templateData.propertyMap.duration}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, duration: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Activity Property"
            placeholder="e.g., Activity (default)"
            value={templateData.propertyMap.activity}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, activity: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Kimai ID Property"
            placeholder="e.g., Kimai ID (default)"
            value={templateData.propertyMap.kimaiId}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, kimaiId: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Tags Property (Optional)"
            placeholder="e.g., Tags (default)"
            value={templateData.propertyMap.tags || ''}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, tags: e.currentTarget.value },
              })
            }
          />

          <Input
            label="Project Property (Optional)"
            placeholder="e.g., Project (default)"
            value={templateData.propertyMap.project || ''}
            onChange={(e) =>
              setTemplateData({
                ...templateData,
                propertyMap: { ...templateData.propertyMap, project: e.currentTarget.value },
              })
            }
          />

          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() =>
                setTemplateData({
                  databaseId: templateData.databaseId,
                  propertyMap: {
                    title: 'Name',
                    date: 'Date',
                    duration: 'Duration',
                    activity: 'Activity',
                    tags: 'Tags',
                    project: 'Project',
                    kimaiId: 'Kimai ID',
                  },
                })
              }
            >
              Reset to Defaults
            </Button>
            <Button variant="default" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate}>Save Template</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
