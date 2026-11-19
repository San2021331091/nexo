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

/// An image NEXO AI made: an HTTPS link, or inline `data:` JPEG bytes from
/// the backup generator.
class GeneratedImage {
  const GeneratedImage({required this.url, this.shape = 'poster'});
  final String url;

  /// `poster` (2:3), `wide` (16:9) or `square`.
  final String shape;

  double get aspectRatio => switch (shape) {
        'wide' => 16 / 9,
        'square' => 1,
        _ => 2 / 3,
      };

  bool get inline => url.startsWith('data:image/');

  static GeneratedImage? fromJson(dynamic json) {
    if (json is! Map) return null;
    final url = '${json['url'] ?? ''}';
    final ok = url.startsWith('https://') || url.startsWith('data:image/');
    return ok
        ? GeneratedImage(url: url, shape: '${json['shape'] ?? 'poster'}')
        : null;
  }

  Map<String, dynamic> toJson() => {'url': url, 'shape': shape};
}

/// The state of a video NEXO AI is making.
class GeneratedVideo {
  const GeneratedVideo(
      {required this.id, this.status = 'queued', this.progress = 0, this.url});
  final String id;

  /// `queued`, `running`, `done` or `failed`.
  final String status;
  final int progress;
  final String? url;

  bool get finished => status == 'done' || status == 'failed';

  static GeneratedVideo? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = '${json['id'] ?? ''}';
    if (!RegExp(r'^[\w-]{4,100}$').hasMatch(id)) return null;
    final url = json['url'];
    return GeneratedVideo(
        id: id,
        status: '${json['status'] ?? 'queued'}',
        progress: (json['progress'] is num)
            ? (json['progress'] as num).round().clamp(0, 100)
            : 0,
        url: url is String && url.startsWith('https://') ? url : null);
  }
}

List<T> _list<T>(dynamic value, T? Function(dynamic) parse) =>
    (value is List ? value : const <dynamic>[])
        .map(parse)
        .whereType<T>()
        .toList();

/// One turn in a NEXO Assistant conversation.
class AssistantMessage {
  const AssistantMessage(
      {required this.role,
      required this.content,
      this.items = const [],
      this.remembered = const [],
      this.images = const [],
      this.videoIds = const []});

  /// `user` or `assistant`.
  final String role;
  final String content;

  /// Titles the assistant mentioned, shown as tappable cards.
  final List<CatalogItem> items;

  /// Facts the assistant saved to memory while writing this answer.
  final List<String> remembered;

  /// Images the assistant made for this answer.
  final List<GeneratedImage> images;

  /// Videos the assistant started; the chat checks on them until ready.
  final List<String> videoIds;

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
        // Inline backup images are large; only linked ones are kept.
        if (images.any((image) => !image.inline))
          'images': [
            for (final image in images)
              if (!image.inline) image.toJson()
          ],
        if (videoIds.isNotEmpty) 'videos': videoIds,
      };

  static AssistantMessage? fromStorage(Map<String, dynamic> json) {
    final role = json['role'];
    final content = '${json['content'] ?? ''}';
    if ((role != 'user' && role != 'assistant') || content.isEmpty) return null;
    return AssistantMessage(
        role: role as String,
        content: content,
        items: _items(json['items']),
        remembered: _strings(json['remembered']),
        images: _list(json['images'], GeneratedImage.fromJson),
        videoIds: _strings(json['videos']));
  }

  /// Parses the API's `{reply, items, remembered}` answer.
  static AssistantMessage fromReply(Map<String, dynamic> json) =>
      AssistantMessage(
        role: 'assistant',
        content: '${json['reply'] ?? ''}'.trim(),
        items: _items(json['items']),
        remembered: _strings(json['remembered']),
        images:
            _list((json['media'] as Map?)?['images'], GeneratedImage.fromJson),
        videoIds: [
          for (final video in _list(
              (json['media'] as Map?)?['videos'], GeneratedVideo.fromJson))
            video.id
        ],
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
