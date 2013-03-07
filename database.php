<?php
require_once("constants.php");

class Database{
	private $connection;

	public function __construct(){
		$this->open_connection();
	}

	public function open_connection(){
		$this->connection = mysql_connect(SERVERNAME, USERNAME, PASSWORD);

		if($this->connection){
			$result = mysql_select_db(DBNAME) ;
			if(!$result){
				die("Could not establish database connection. " . mysql_error());
			}
		} else {
			die("Could not connect to server. " . mysql_error()) ;
		}
	}

	public function close_connection(){
		mysql_close($this->connection);
	}

	public function query($sql=""){
		if(isset($sql)){
			$resultSet = mysql_query($sql, $this->connection);
			if($this->confirm_query($resultSet)){
				return $resultSet;
			} else{
				die("Query Failed: " . mysql_error());
			}
		}
	}

	public function confirm_query($result_set){
		if($result_set){
			return true;
		} else {
			return false;
		}
	}

	public function insert_id(){
		return mysql_insert_id($this->connection);
	}

	public function numAffectedRows(){
		return mysql_affected_rows($this->connection);
	}

}

$db = new Database();

?>