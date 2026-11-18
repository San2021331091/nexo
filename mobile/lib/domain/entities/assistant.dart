import 'catalog_item.dart';

/// A failed assistant request, with a message that can be shown as is.
class AssistantException implements Exception {
  const AssistantException(this.message);
  final String message;
  @override
  String toString() => message;
}

List<CatalogItem> _items(dynamic value) =>
    (value is List ? value : const <dynamic>[])
        .whereType<Map<dynamic, dynamic>>()
        .map((item) => CatalogItem.fromJson(Map<String, dynamic>.from(item)))
        .where((item) => item.id.isNotEmpty)
        .toList();

List<String> _strings(dynamic value) =>
    (value is List ? value : const <dynamic>[])
        .map((item) => '$item'.trim())
        .where((item) => item.isNotEmpty)
        .toList();

/// One turn in a NEXO Assistant conversation.
class AssistantMessage {
  const AssistantMessage(
      {required this.role,
      required this.content,
      this.items = const [],
      this.remembered = const []});

  /// `user` or `assistant`.
  final String role;
  final String content;

  /// Titles the assistant mentioned, shown as tappable cards.
  final List<CatalogItem> items;

  /// Facts the assistant saved to memory while writing this answer.
  final List<String> remembered;

  bool get fromUser => role == 'user';

  /// What the API is sent for earlier turns.
  Map<String, dynamic> toJson() => {'role': role, 'content': content};

  /// Everything, for keeping the chat on the device.
  Map<String, dynamic> toStorage() => {
        'role': role,
        'content': content,
        if (items.isNotEmpty)
          'items': [for (final item in items) item.toJson()],
        if (remembered.isNotEmpty) 'remembered': remembered,
      };

  static AssistantMessage? fromStorage(Map<String, dynamic> json) {
    final role = json['role'];
    final content = '${json['content'] ?? ''}';
    if ((role != 'user' && role != 'assistant') || content.isEmpty) return null;
    return AssistantMessage(
        role: role as String,
        content: content,
        items: _items(json['items']),
        remembered: _strings(json['remembered']));
  }

  /// Parses the API's `{reply, items, remembered}` answer.
  static AssistantMessage fromReply(Map<String, dynamic> json) =>
      AssistantMessage(
        role: 'assistant',
        content: '${json['reply'] ?? ''}'.trim(),
        items: _items(json['items']),
        remembered: _strings(json['remembered']),
      );
}

/// A saved conversation, listed in the chat history.
class AssistantChat {
  const AssistantChat(
      {required this.id,
      required this.title,
      required this.updatedAt,
      required this.messages});
  final String id;
  final String title;
  final DateTime updatedAt;
  final List<AssistantMessage> messages;

  /// The first question, shortened, names the chat.
  static String titleFor(List<AssistantMessage> messages) {
    final first = messages
        .firstWhere((message) => message.fromUser,
            orElse: () =>
                const AssistantMessage(role: 'user', content: 'New chat'))
        .content
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    return first.length > 48 ? '${first.substring(0, 47)}…' : first;
  }

  Map<String, dynamic> toStorage() => {
        'id': id,
        'title': title,
        'updatedAt': updatedAt.toIso8601String(),
        'messages': [for (final message in messages) message.toStorage()],
      };

  static AssistantChat? fromStorage(Map<String, dynamic> json) {
    final id = '${json['id'] ?? ''}';
    final messages = (json['messages'] is List
            ? json['messages'] as List
            : const <dynamic>[])
        .whereType<Map<dynamic, dynamic>>()
        .map((value) =>
            AssistantMessage.fromStorage(Map<String, dynamic>.from(value)))
        .whereType<AssistantMessage>()
        .toList();
    if (id.isEmpty || messages.isEmpty) return null;
    return AssistantChat(
        id: id,
        title: '${json['title'] ?? AssistantChat.titleFor(messages)}',
        updatedAt: DateTime.tryParse('${json['updatedAt']}') ?? DateTime.now(),
        messages: messages);
  }
}
