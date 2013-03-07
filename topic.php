<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
include_once("header.php");

class Topic extends DatabaseObject{

	protected static $tablename = "topics";
	protected static $attributes = array('id','category_id', 'description','topic_title','topic_creator','topic_date', 'video_name', 'video_size', 'video_type', 'video_temp_name');

	public $id;
	public $category_id;
	public $description;
	public $topic_title;
	public $topic_creator;
	public $topic_date;
	public $video_name;
	public $video_size;
	public $video_type;
	public $video_temp_name;

	public static function newTopic($categoryId, $description,$title, $creatorId, $vidName, $vidSize, $vidType, $vidTempName){
		global $db;

		$dateTime = new DateTime("now", new DateTimeZone('America/Los_Angeles'));
		$Object = new static;

		$Object->category_id = $categoryId;
		$Object->description = $description;
		$Object->topic_title = $title;
		$Object->topic_creator = $creatorId;
		$Object->topic_date = $dateTime->format("Y-m-d H:i:s");
		$Object->video_name = $vidName;
		$Object->video_size = $vidSize;
		$Object->video_type = $vidType;
		$Object->video_temp_name = $vidTempName;

		return $Object;
	}

	public function topicTitle(){
		echo $this->topic_title;
	}

	public function find_by_category_id($cid){
		global $db;
		$sql = "SELECT * FROM " . static::$tablename . " WHERE category_id='" . $cid . "'" ;
		$result = $db->query($sql);
		while($row = mysql_fetch_array($result)){
			$object_array[] = static::instantiate($row);
		}
		return $object_array;

	}

}
?>

<?php
include_once("footer.php");
?>