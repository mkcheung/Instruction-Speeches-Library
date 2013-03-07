<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
include_once("header.php");

class Note extends DatabaseObject{

	protected static $tablename = "notes";
	protected static $attributes = array('id', 'topic_id', 'note', 'title', 'created', 'modified');

	public $id;
	public $topic_id;
	public $note;
	public $title;
	public $created;
	public $modified;

	public static function newNote($tid, $n, $t){
		$Object = new static;
		$dateTime = new DateTime("now", new DateTimeZone('America/Los_Angeles'));
		$Object->created = $dateTime->format("Y-m-d H:i:s");
		$Object->modified = $dateTime->format("Y-m-d H:i:s");
		$Object->topic_id = $tid;
		$Object->note = $n ;
		$Object->title = $t ;

		return $Object;
	}

	public function find_notes_by_topic_id($topicId){
		global $db;

		$sql = "SELECT * FROM " . static::$tablename . " WHERE topic_id ='" . $topicId . "'";

		$resultSet = $db->query($sql) ;

		while ($row = mysql_fetch_assoc($resultSet)){
			$object_array[] = static::instantiate($row);
		}

		return $object_array;
	}

} // end class Note


?>

<?php
include_once("footer.php");
?>